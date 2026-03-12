use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use chrono::{DateTime, Utc};
use pgvector::Vector;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row, migrate::Migrator, postgres::PgPoolOptions};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::indexing::chunking::ParsedBlock;

mod chunking;
mod embeddings;

use embeddings::{EmbeddingProvider, provider_from_env};

const MAX_INDEXED_FILE_BYTES: u64 = 2_000_000;
const EMBEDDING_BATCH_SIZE: usize = 32;
const RRF_K: f64 = 60.0;
const INDEX_INCLUDE_SENSITIVE_FILES_ENV: &str = "EXPLORER_INDEX_INCLUDE_SENSITIVE_FILES";
const SENSITIVE_EXTENSIONS: [&str; 7] = ["pem", "key", "p12", "pfx", "crt", "cer", "der"];
const SENSITIVE_PATH_SEGMENTS: [&str; 3] = [".ssh", ".aws", ".gnupg"];
const SENSITIVE_FILENAME_TOKENS: [&str; 5] =
    ["secret", "token", "credential", "password", "passwd"];

#[derive(Clone)]
pub struct IndexingService {
    inner: Arc<IndexingInner>,
}

struct IndexingInner {
    root_dir: Arc<PathBuf>,
    pool: PgPool,
    queue_state: Mutex<QueueState>,
    embeddings: Arc<dyn EmbeddingProvider>,
}

#[derive(Debug, Default)]
struct QueueState {
    running: Option<Uuid>,
    pending: Option<Uuid>,
}

#[derive(Debug, Clone, Copy)]
struct EnqueueDecision {
    start_immediately: bool,
    replaced_pending: Option<Uuid>,
}

#[derive(Debug, Clone, Copy, Default)]
struct JobCounters {
    files_scanned: i64,
    files_indexed: i64,
    blocks_indexed: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct EnqueueIndexResponse {
    pub job_id: String,
    pub status: String,
    pub replaced_pending: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct IndexJobView {
    pub job_id: String,
    pub status: String,
    pub requested_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub files_scanned: i64,
    pub files_indexed: i64,
    pub blocks_indexed: i64,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct IndexStatusView {
    pub current_job: Option<IndexJobView>,
    pub pending: bool,
    pub last_completed_job: Option<IndexJobView>,
}

#[derive(Debug, Serialize, Clone)]
pub struct UserProfile {
    pub id: i64,
    pub display_name: String,
    pub email: String,
    pub bio: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct KeywordMatch {
    pub path: String,
    pub line_number: usize,
    pub line: String,
}

#[derive(Debug, Clone)]
pub struct HybridMatch {
    pub path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub snippet: String,
    pub score: f64,
    pub sources: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct HybridSearch {
    pub warnings: Vec<String>,
    pub matches: Vec<HybridMatch>,
}

#[derive(Debug)]
pub enum SearchError {
    NoIndex,
    Message(String),
}

#[derive(Debug)]
pub enum ProfileError {
    DuplicateEmail,
    NotFound,
    Message(String),
}

impl SearchError {
    pub fn message(self) -> String {
        match self {
            Self::NoIndex => {
                "no index exists yet; trigger indexing first with POST /api/index".to_string()
            }
            Self::Message(message) => message,
        }
    }
}

impl ProfileError {
    pub fn message(self) -> String {
        match self {
            Self::DuplicateEmail => "a profile with this email already exists".to_string(),
            Self::NotFound => "profile not found".to_string(),
            Self::Message(message) => message,
        }
    }
}

impl IndexingService {
    pub async fn from_env(root_dir: Arc<PathBuf>) -> Result<Option<Self>, String> {
        let Some(database_url) = env::var("DATABASE_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
        else {
            return Ok(None);
        };

        let pool = PgPoolOptions::new()
            .max_connections(8)
            .connect(&database_url)
            .await
            .map_err(|error| format!("failed to connect to DATABASE_URL: {error}"))?;

        load_migrator()
            .await
            .map_err(|error| format!("failed to load database migrations: {error}"))?
            .run(&pool)
            .await
            .map_err(|error| format!("failed to run database migrations: {error}"))?;

        let embeddings = provider_from_env()?;

        Ok(Some(Self {
            inner: Arc::new(IndexingInner {
                root_dir,
                pool,
                queue_state: Mutex::new(QueueState::default()),
                embeddings,
            }),
        }))
    }

    pub async fn enqueue_index(&self) -> Result<EnqueueIndexResponse, String> {
        let job_id = Uuid::new_v4();
        self.insert_queued_job(job_id).await?;

        let enqueue = {
            let mut queue = self.inner.queue_state.lock().await;
            apply_enqueue(&mut queue, job_id)
        };
        let start_immediately = enqueue.start_immediately;
        let replaced_pending = enqueue.replaced_pending;

        if let Some(replaced_job_id) = replaced_pending {
            let _ = self
                .mark_job_failed(
                    replaced_job_id,
                    "replaced by a newer queued indexing request",
                    JobCounters::default(),
                )
                .await;
        }

        if start_immediately {
            self.mark_job_running(job_id).await?;
            self.spawn_job(job_id);
        }

        Ok(EnqueueIndexResponse {
            job_id: job_id.to_string(),
            status: if start_immediately {
                "running".to_string()
            } else {
                "queued".to_string()
            },
            replaced_pending: replaced_pending.is_some(),
        })
    }

    pub async fn status(&self) -> Result<IndexStatusView, String> {
        let (running, pending) = {
            let queue = self.inner.queue_state.lock().await;
            (queue.running, queue.pending)
        };

        let current_job_id = running.or(pending);
        let current_job = if let Some(job_id) = current_job_id {
            self.fetch_job(job_id).await?
        } else {
            None
        };

        let last_completed_job = self.fetch_last_completed_job().await?;

        Ok(IndexStatusView {
            current_job,
            pending: pending.is_some(),
            last_completed_job,
        })
    }

    pub async fn create_profile(
        &self,
        display_name: &str,
        email: &str,
        bio: &str,
    ) -> Result<UserProfile, ProfileError> {
        let row = sqlx::query(
            "
            INSERT INTO user_profiles (display_name, email, bio)
            VALUES ($1, $2, $3)
            RETURNING id, display_name, email, bio, created_at
            ",
        )
        .bind(display_name)
        .bind(email)
        .bind(bio)
        .fetch_one(&self.inner.pool)
        .await
        .map_err(|error| match &error {
            sqlx::Error::Database(db_error) if db_error.code().as_deref() == Some("23505") => {
                ProfileError::DuplicateEmail
            }
            _ => ProfileError::Message(format!("failed to create user profile: {error}")),
        })?;

        Ok(user_profile_from_row(row))
    }

    pub async fn list_profiles(&self) -> Result<Vec<UserProfile>, ProfileError> {
        let rows = sqlx::query(
            "
            SELECT id, display_name, email, bio, created_at
            FROM user_profiles
            ORDER BY created_at DESC, id DESC
            ",
        )
        .fetch_all(&self.inner.pool)
        .await
        .map_err(|error| ProfileError::Message(format!("failed to list user profiles: {error}")))?;

        Ok(rows.into_iter().map(user_profile_from_row).collect())
    }

    pub async fn update_profile(
        &self,
        id: i64,
        display_name: Option<&str>,
        email: Option<&str>,
        bio: Option<&str>,
    ) -> Result<UserProfile, ProfileError> {
        let row = sqlx::query(
            "
            UPDATE user_profiles
            SET
                display_name = COALESCE($2, display_name),
                email = COALESCE($3, email),
                bio = COALESCE($4, bio)
            WHERE id = $1
            RETURNING id, display_name, email, bio, created_at
            ",
        )
        .bind(id)
        .bind(display_name)
        .bind(email)
        .bind(bio)
        .fetch_optional(&self.inner.pool)
        .await
        .map_err(|error| match &error {
            sqlx::Error::Database(db_error) if db_error.code().as_deref() == Some("23505") => {
                ProfileError::DuplicateEmail
            }
            _ => ProfileError::Message(format!("failed to update user profile: {error}")),
        })?;

        let row = row.ok_or(ProfileError::NotFound)?;
        Ok(user_profile_from_row(row))
    }

    pub async fn keyword_search(
        &self,
        query: &str,
        path_filter: Option<&str>,
        limit: usize,
    ) -> Result<Vec<KeywordMatch>, SearchError> {
        if !self.has_any_index().await.map_err(SearchError::Message)? {
            return Err(SearchError::NoIndex);
        }

        let path_prefix = normalized_path_prefix(path_filter);
        let sql = "
            SELECT path, start_line, content
            FROM semantic_blocks
            WHERE ($1::text IS NULL OR path LIKE $1 ESCAPE '\\\\')
              AND keyword_tsv @@ websearch_to_tsquery('simple', $2)
            ORDER BY ts_rank_cd(keyword_tsv, websearch_to_tsquery('simple', $2)) DESC
            LIMIT $3
        ";

        let rows = sqlx::query(sql)
            .bind(path_prefix)
            .bind(query)
            .bind(limit as i64)
            .fetch_all(&self.inner.pool)
            .await
            .map_err(|error| {
                SearchError::Message(format!("keyword search query failed: {error}"))
            })?;

        let mut matches = Vec::with_capacity(rows.len());
        for row in rows {
            let path: String = row.get("path");
            let block_start_line: i32 = row.get("start_line");
            let content: String = row.get("content");
            let (line_number, line) = first_matching_line(block_start_line, &content, query);
            matches.push(KeywordMatch {
                path,
                line_number: line_number.max(1) as usize,
                line,
            });
        }

        Ok(matches)
    }

    pub async fn hybrid_search(
        &self,
        query: &str,
        path_filter: Option<&str>,
        limit: usize,
    ) -> Result<HybridSearch, SearchError> {
        if !self.has_any_index().await.map_err(SearchError::Message)? {
            return Err(SearchError::NoIndex);
        }

        let path_prefix = normalized_path_prefix(path_filter);
        let keyword_candidates = self
            .keyword_candidates(query, path_prefix.clone(), limit)
            .await
            .map_err(SearchError::Message)?;

        let mut warnings = Vec::new();
        let semantic_candidates = match self
            .semantic_candidates(query, path_prefix.clone(), limit)
            .await
        {
            Ok(items) => items,
            Err(error) => {
                warnings.push(format!(
                    "semantic search unavailable; returned keyword-only results: {error}"
                ));
                Vec::new()
            }
        };

        let mut fused: HashMap<String, FusedEntry> = HashMap::new();

        for (rank, candidate) in keyword_candidates.iter().enumerate() {
            let score = 1.0 / (RRF_K + rank as f64 + 1.0);
            let key = candidate.key();
            let entry = fused.entry(key).or_insert_with(|| FusedEntry {
                path: candidate.path.clone(),
                start_line: candidate.start_line,
                end_line: candidate.end_line,
                snippet: candidate.snippet.clone(),
                score: 0.0,
                sources: HashSet::new(),
            });
            entry.score += score;
            entry.sources.insert("keyword".to_string());
        }

        for (rank, candidate) in semantic_candidates.iter().enumerate() {
            let score = 1.0 / (RRF_K + rank as f64 + 1.0);
            let key = candidate.key();
            let entry = fused.entry(key).or_insert_with(|| FusedEntry {
                path: candidate.path.clone(),
                start_line: candidate.start_line,
                end_line: candidate.end_line,
                snippet: candidate.snippet.clone(),
                score: 0.0,
                sources: HashSet::new(),
            });
            entry.score += score;
            entry.sources.insert("semantic".to_string());
        }

        let mut matches: Vec<HybridMatch> = fused
            .into_values()
            .map(|entry| {
                let mut sources = entry.sources.into_iter().collect::<Vec<_>>();
                sources.sort();
                HybridMatch {
                    path: entry.path,
                    start_line: entry.start_line.max(1) as usize,
                    end_line: entry.end_line.max(1) as usize,
                    snippet: entry.snippet,
                    score: entry.score,
                    sources,
                }
            })
            .collect();

        matches.sort_by(|left, right| right.score.total_cmp(&left.score));
        matches.truncate(limit);

        Ok(HybridSearch { warnings, matches })
    }

    fn spawn_job(&self, job_id: Uuid) {
        let service = self.clone();
        tokio::spawn(async move {
            service.run_job(job_id).await;
        });
    }

    async fn run_job(&self, job_id: Uuid) {
        let counters = match self.execute_index(job_id).await {
            Ok(counters) => {
                let _ = self.mark_job_succeeded(job_id, counters).await;
                counters
            }
            Err(error) => {
                let counters = self.current_counters(job_id).await.unwrap_or_default();
                let _ = self.mark_job_failed(job_id, &error, counters).await;
                counters
            }
        };

        let next_job = {
            let mut queue = self.inner.queue_state.lock().await;
            if queue.running == Some(job_id) {
                queue.running = None;
            }

            if queue.running.is_none() {
                if let Some(next_id) = queue.pending.take() {
                    queue.running = Some(next_id);
                    Some(next_id)
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(next_job_id) = next_job {
            if let Err(error) = self.mark_job_running(next_job_id).await {
                let _ = self
                    .mark_job_failed(next_job_id, &error, JobCounters::default())
                    .await;

                let mut queue = self.inner.queue_state.lock().await;
                if queue.running == Some(next_job_id) {
                    queue.running = None;
                }
            } else {
                self.spawn_job(next_job_id);
            }
        }

        let _ = counters;
    }

    async fn execute_index(&self, job_id: Uuid) -> Result<JobCounters, String> {
        self.inner.embeddings.ensure_available()?;

        let known_hashes = self.load_known_hashes().await?;
        let changed_files = self.scan_changed_files(job_id, &known_hashes).await?;
        let mut counters = self.current_counters(job_id).await.unwrap_or_default();

        for changed in changed_files {
            let blocks = chunking::parse_semantic_blocks(&changed.path, &changed.content);
            let embeddings = self
                .embed_blocks(
                    &blocks
                        .iter()
                        .map(|block| block.content.clone())
                        .collect::<Vec<_>>(),
                )
                .await?;

            if embeddings.len() != blocks.len() {
                return Err(format!(
                    "embedding count mismatch for {}: got {}, expected {}",
                    changed.path,
                    embeddings.len(),
                    blocks.len()
                ));
            }

            self.persist_file(&changed.path, &changed.hash, &blocks, &embeddings)
                .await?;

            counters.blocks_indexed += blocks.len() as i64;
            self.update_job_counters(job_id, counters).await?;
        }

        Ok(counters)
    }

    async fn persist_file(
        &self,
        path: &str,
        hash: &str,
        blocks: &[ParsedBlock],
        embeddings: &[Vec<f32>],
    ) -> Result<(), String> {
        let mut tx = self
            .inner
            .pool
            .begin()
            .await
            .map_err(|error| format!("failed to open persistence transaction: {error}"))?;

        sqlx::query("DELETE FROM semantic_blocks WHERE path = $1")
            .bind(path)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("failed to delete old semantic blocks for {path}: {error}"))?;

        for (block, embedding) in blocks.iter().zip(embeddings.iter()) {
            sqlx::query(
                "
                INSERT INTO semantic_blocks (
                    path,
                    start_line,
                    end_line,
                    content,
                    snippet,
                    embedding,
                    content_hash,
                    updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                ON CONFLICT (path, start_line, end_line)
                DO UPDATE SET
                    content = EXCLUDED.content,
                    snippet = EXCLUDED.snippet,
                    embedding = EXCLUDED.embedding,
                    content_hash = EXCLUDED.content_hash,
                    updated_at = NOW()
                ",
            )
            .bind(path)
            .bind(block.start_line)
            .bind(block.end_line)
            .bind(&block.content)
            .bind(&block.snippet)
            .bind(Vector::from(embedding.clone()))
            .bind(hash)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("failed to insert semantic block for {path}: {error}"))?;
        }

        sqlx::query(
            "
            INSERT INTO indexed_files (path, content_hash, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (path)
            DO UPDATE SET content_hash = EXCLUDED.content_hash, updated_at = NOW()
            ",
        )
        .bind(path)
        .bind(hash)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to upsert file hash for {path}: {error}"))?;

        tx.commit()
            .await
            .map_err(|error| format!("failed to commit persistence transaction: {error}"))
    }

    async fn scan_changed_files(
        &self,
        job_id: Uuid,
        known_hashes: &HashMap<String, String>,
    ) -> Result<Vec<ChangedFile>, String> {
        let include_sensitive_files = include_sensitive_files_in_index();
        let mut builder = ignore::WalkBuilder::new(self.inner.root_dir.as_ref());
        builder
            .standard_filters(true)
            .hidden(!include_sensitive_files)
            .git_ignore(true);

        let mut changed_files = Vec::new();
        let mut counters = self.current_counters(job_id).await.unwrap_or_default();

        for item in builder.build() {
            let entry = match item {
                Ok(entry) => entry,
                Err(_) => continue,
            };

            let path = entry.path();
            if !include_sensitive_files && is_sensitive_path(path) {
                continue;
            }

            if path
                .components()
                .any(|component| component.as_os_str() == ".git")
            {
                continue;
            }

            let Some(metadata) = indexable_file_metadata(path) else {
                continue;
            };
            if metadata.len() > MAX_INDEXED_FILE_BYTES {
                continue;
            }

            let bytes = match fs::read(path) {
                Ok(bytes) => bytes,
                Err(_) => continue,
            };
            if bytes.contains(&0) {
                continue;
            }

            let content = match String::from_utf8(bytes) {
                Ok(content) => content,
                Err(_) => continue,
            };

            counters.files_scanned += 1;
            if counters.files_scanned % 25 == 0 {
                self.update_job_counters(job_id, counters).await?;
            }

            let Some(relative_path) = to_relative(path, self.inner.root_dir.as_ref()) else {
                continue;
            };

            let hash = sha256_hex(content.as_bytes());
            if known_hashes
                .get(&relative_path)
                .is_some_and(|known| known == &hash)
            {
                continue;
            }

            counters.files_indexed += 1;
            changed_files.push(ChangedFile {
                path: relative_path,
                hash,
                content,
            });
            self.update_job_counters(job_id, counters).await?;
        }

        Ok(changed_files)
    }

    async fn load_known_hashes(&self) -> Result<HashMap<String, String>, String> {
        let rows = sqlx::query("SELECT path, content_hash FROM indexed_files")
            .fetch_all(&self.inner.pool)
            .await
            .map_err(|error| format!("failed to load known file hashes: {error}"))?;

        let mut hashes = HashMap::with_capacity(rows.len());
        for row in rows {
            hashes.insert(
                row.get::<String, _>("path"),
                row.get::<String, _>("content_hash"),
            );
        }

        Ok(hashes)
    }

    async fn embed_blocks(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, String> {
        if inputs.is_empty() {
            return Ok(Vec::new());
        }

        let mut all = Vec::with_capacity(inputs.len());
        for chunk in inputs.chunks(EMBEDDING_BATCH_SIZE) {
            let batch = self.inner.embeddings.embed(chunk).await?;
            all.extend(batch);
        }

        Ok(all)
    }

    async fn keyword_candidates(
        &self,
        query: &str,
        path_prefix: Option<String>,
        limit: usize,
    ) -> Result<Vec<SearchCandidate>, String> {
        let rows = sqlx::query(
            "
            SELECT path, start_line, end_line, snippet
            FROM semantic_blocks
            WHERE ($1::text IS NULL OR path LIKE $1 ESCAPE '\\\\')
              AND keyword_tsv @@ websearch_to_tsquery('simple', $2)
            ORDER BY ts_rank_cd(keyword_tsv, websearch_to_tsquery('simple', $2)) DESC
            LIMIT $3
            ",
        )
        .bind(path_prefix)
        .bind(query)
        .bind(limit as i64)
        .fetch_all(&self.inner.pool)
        .await
        .map_err(|error| format!("failed to execute keyword candidate query: {error}"))?;

        Ok(rows.into_iter().map(SearchCandidate::from_row).collect())
    }

    async fn semantic_candidates(
        &self,
        query: &str,
        path_prefix: Option<String>,
        limit: usize,
    ) -> Result<Vec<SearchCandidate>, String> {
        let vectors = self.inner.embeddings.embed(&[query.to_string()]).await?;
        let Some(vector) = vectors.into_iter().next() else {
            return Err("embedding provider returned no vector for query".to_string());
        };

        let rows = sqlx::query(
            "
            SELECT path, start_line, end_line, snippet
            FROM semantic_blocks
            WHERE ($1::text IS NULL OR path LIKE $1 ESCAPE '\\\\')
            ORDER BY embedding <=> $2
            LIMIT $3
            ",
        )
        .bind(path_prefix)
        .bind(Vector::from(vector))
        .bind(limit as i64)
        .fetch_all(&self.inner.pool)
        .await
        .map_err(|error| format!("failed to execute semantic candidate query: {error}"))?;

        Ok(rows.into_iter().map(SearchCandidate::from_row).collect())
    }

    async fn has_any_index(&self) -> Result<bool, String> {
        let has_index: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM indexed_files)")
            .fetch_one(&self.inner.pool)
            .await
            .map_err(|error| format!("failed to check index existence: {error}"))?;

        Ok(has_index)
    }

    async fn insert_queued_job(&self, job_id: Uuid) -> Result<(), String> {
        sqlx::query("INSERT INTO index_jobs (id, status) VALUES ($1, 'queued')")
            .bind(job_id)
            .execute(&self.inner.pool)
            .await
            .map_err(|error| format!("failed to create queued index job: {error}"))?;

        Ok(())
    }

    async fn mark_job_running(&self, job_id: Uuid) -> Result<(), String> {
        sqlx::query(
            "
            UPDATE index_jobs
            SET status = 'running', started_at = NOW(), finished_at = NULL, error = NULL
            WHERE id = $1
            ",
        )
        .bind(job_id)
        .execute(&self.inner.pool)
        .await
        .map_err(|error| format!("failed to mark index job running: {error}"))?;

        Ok(())
    }

    async fn mark_job_succeeded(&self, job_id: Uuid, counters: JobCounters) -> Result<(), String> {
        sqlx::query(
            "
            UPDATE index_jobs
            SET status = 'succeeded',
                finished_at = NOW(),
                files_scanned = $2,
                files_indexed = $3,
                blocks_indexed = $4,
                error = NULL
            WHERE id = $1
            ",
        )
        .bind(job_id)
        .bind(counters.files_scanned)
        .bind(counters.files_indexed)
        .bind(counters.blocks_indexed)
        .execute(&self.inner.pool)
        .await
        .map_err(|error| format!("failed to mark index job succeeded: {error}"))?;

        Ok(())
    }

    async fn mark_job_failed(
        &self,
        job_id: Uuid,
        error: &str,
        counters: JobCounters,
    ) -> Result<(), String> {
        sqlx::query(
            "
            UPDATE index_jobs
            SET status = 'failed',
                finished_at = NOW(),
                files_scanned = $2,
                files_indexed = $3,
                blocks_indexed = $4,
                error = $5
            WHERE id = $1
            ",
        )
        .bind(job_id)
        .bind(counters.files_scanned)
        .bind(counters.files_indexed)
        .bind(counters.blocks_indexed)
        .bind(error)
        .execute(&self.inner.pool)
        .await
        .map_err(|update_error| format!("failed to mark index job failed: {update_error}"))?;

        Ok(())
    }

    async fn update_job_counters(&self, job_id: Uuid, counters: JobCounters) -> Result<(), String> {
        sqlx::query(
            "
            UPDATE index_jobs
            SET files_scanned = $2,
                files_indexed = $3,
                blocks_indexed = $4
            WHERE id = $1
            ",
        )
        .bind(job_id)
        .bind(counters.files_scanned)
        .bind(counters.files_indexed)
        .bind(counters.blocks_indexed)
        .execute(&self.inner.pool)
        .await
        .map_err(|error| format!("failed to update index job counters: {error}"))?;

        Ok(())
    }

    async fn current_counters(&self, job_id: Uuid) -> Result<JobCounters, String> {
        let maybe_row = sqlx::query(
            "
            SELECT files_scanned, files_indexed, blocks_indexed
            FROM index_jobs
            WHERE id = $1
            ",
        )
        .bind(job_id)
        .fetch_optional(&self.inner.pool)
        .await
        .map_err(|error| format!("failed to load current index job counters: {error}"))?;

        let Some(row) = maybe_row else {
            return Ok(JobCounters::default());
        };

        Ok(JobCounters {
            files_scanned: row.get("files_scanned"),
            files_indexed: row.get("files_indexed"),
            blocks_indexed: row.get("blocks_indexed"),
        })
    }

    async fn fetch_job(&self, job_id: Uuid) -> Result<Option<IndexJobView>, String> {
        let row = sqlx::query(
            "
            SELECT id, status, requested_at, started_at, finished_at,
                   files_scanned, files_indexed, blocks_indexed, error
            FROM index_jobs
            WHERE id = $1
            ",
        )
        .bind(job_id)
        .fetch_optional(&self.inner.pool)
        .await
        .map_err(|error| format!("failed to fetch index job by id: {error}"))?;

        Ok(row.map(job_view_from_row))
    }

    async fn fetch_last_completed_job(&self) -> Result<Option<IndexJobView>, String> {
        let row = sqlx::query(
            "
            SELECT id, status, requested_at, started_at, finished_at,
                   files_scanned, files_indexed, blocks_indexed, error
            FROM index_jobs
            WHERE status IN ('succeeded', 'failed')
            ORDER BY requested_at DESC
            LIMIT 1
            ",
        )
        .fetch_optional(&self.inner.pool)
        .await
        .map_err(|error| format!("failed to fetch latest completed index job: {error}"))?;

        Ok(row.map(job_view_from_row))
    }
}

async fn load_migrator() -> Result<Migrator, sqlx::migrate::MigrateError> {
    Migrator::new(Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations")).await
}

#[derive(Debug)]
struct ChangedFile {
    path: String,
    hash: String,
    content: String,
}

#[derive(Debug, Clone)]
struct SearchCandidate {
    path: String,
    start_line: i32,
    end_line: i32,
    snippet: String,
}

impl SearchCandidate {
    fn from_row(row: sqlx::postgres::PgRow) -> Self {
        Self {
            path: row.get("path"),
            start_line: row.get("start_line"),
            end_line: row.get("end_line"),
            snippet: row.get("snippet"),
        }
    }

    fn key(&self) -> String {
        format!("{}:{}:{}", self.path, self.start_line, self.end_line)
    }
}

#[derive(Debug)]
struct FusedEntry {
    path: String,
    start_line: i32,
    end_line: i32,
    snippet: String,
    score: f64,
    sources: HashSet<String>,
}

fn job_view_from_row(row: sqlx::postgres::PgRow) -> IndexJobView {
    let requested_at: DateTime<Utc> = row.get("requested_at");
    let started_at: Option<DateTime<Utc>> = row.get("started_at");
    let finished_at: Option<DateTime<Utc>> = row.get("finished_at");

    IndexJobView {
        job_id: row.get::<Uuid, _>("id").to_string(),
        status: row.get("status"),
        requested_at: requested_at.to_rfc3339(),
        started_at: started_at.map(|value| value.to_rfc3339()),
        finished_at: finished_at.map(|value| value.to_rfc3339()),
        files_scanned: row.get("files_scanned"),
        files_indexed: row.get("files_indexed"),
        blocks_indexed: row.get("blocks_indexed"),
        error: row.get("error"),
    }
}

fn user_profile_from_row(row: sqlx::postgres::PgRow) -> UserProfile {
    let created_at: DateTime<Utc> = row.get("created_at");

    UserProfile {
        id: row.get("id"),
        display_name: row.get("display_name"),
        email: row.get("email"),
        bio: row.get("bio"),
        created_at: created_at.to_rfc3339(),
    }
}

fn to_relative(path: &std::path::Path, root: &std::path::Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    Some(relative.to_string_lossy().replace('\\', "/"))
}

fn normalized_path_prefix(path_filter: Option<&str>) -> Option<String> {
    let filter = path_filter
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    let escaped = filter
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");

    Some(format!("{escaped}%"))
}

fn sha256_hex(input: &[u8]) -> String {
    let digest = Sha256::digest(input);
    format!("{digest:x}")
}

fn first_matching_line(start_line: i32, content: &str, query: &str) -> (i32, String) {
    let query_lower = query.to_lowercase();
    for (offset, line) in content.lines().enumerate() {
        if line.to_lowercase().contains(&query_lower) {
            return (start_line + offset as i32, line.trim().to_string());
        }
    }

    let fallback = content
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    (start_line, fallback)
}

fn apply_enqueue(queue: &mut QueueState, job_id: Uuid) -> EnqueueDecision {
    if queue.running.is_none() {
        queue.running = Some(job_id);
        EnqueueDecision {
            start_immediately: true,
            replaced_pending: None,
        }
    } else {
        EnqueueDecision {
            start_immediately: false,
            replaced_pending: queue.pending.replace(job_id),
        }
    }
}

fn include_sensitive_files_in_index() -> bool {
    env::var(INDEX_INCLUDE_SENSITIVE_FILES_ENV)
        .ok()
        .and_then(|value| parse_env_bool(&value))
        .unwrap_or(false)
}

fn indexable_file_metadata(path: &Path) -> Option<fs::Metadata> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return None;
    }

    Some(metadata)
}

fn parse_env_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn is_sensitive_path(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if file_name == ".env" || file_name.starts_with(".env.") {
        return true;
    }

    if SENSITIVE_FILENAME_TOKENS
        .iter()
        .any(|token| file_name.contains(token))
    {
        return true;
    }

    if let Some(extension) = path.extension().and_then(|ext| ext.to_str()) {
        let extension = extension.to_ascii_lowercase();
        if SENSITIVE_EXTENSIONS.contains(&extension.as_str()) {
            return true;
        }
    }

    path.components().any(|component| match component {
        Component::Normal(part) => {
            let segment = part.to_string_lossy().to_ascii_lowercase();
            SENSITIVE_PATH_SEGMENTS.contains(&segment.as_str())
        }
        _ => false,
    })
}

#[doc(hidden)]
// Keep this function in the library crate so the standalone fuzz target in backend/fuzz
// can call it directly without introducing fuzzing dependencies into the runtime backend.
pub fn fuzz_parse_semantic_blocks(path: &str, content: &str) {
    let _ = chunking::parse_semantic_blocks(path, content);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_prefix_escapes_like_control_characters() {
        let prefix = normalized_path_prefix(Some("src/%_"));
        assert_eq!(prefix.as_deref(), Some("src/\\%\\_%"));
    }

    #[test]
    fn first_matching_line_falls_back_to_first_line_when_query_missing() {
        let (line_number, line) = first_matching_line(20, "alpha\nbeta", "missing");
        assert_eq!(line_number, 20);
        assert_eq!(line, "alpha");
    }

    #[test]
    fn enqueue_transition_starts_immediately_when_idle() {
        let mut queue = QueueState::default();
        let job_id = Uuid::new_v4();

        let decision = apply_enqueue(&mut queue, job_id);

        assert!(decision.start_immediately);
        assert_eq!(decision.replaced_pending, None);
        assert_eq!(queue.running, Some(job_id));
        assert_eq!(queue.pending, None);
    }

    #[test]
    fn enqueue_transition_queues_when_job_is_running() {
        let running_job = Uuid::new_v4();
        let mut queue = QueueState {
            running: Some(running_job),
            pending: None,
        };
        let queued_job = Uuid::new_v4();

        let decision = apply_enqueue(&mut queue, queued_job);

        assert!(!decision.start_immediately);
        assert_eq!(decision.replaced_pending, None);
        assert_eq!(queue.running, Some(running_job));
        assert_eq!(queue.pending, Some(queued_job));
    }

    #[test]
    fn enqueue_transition_replaces_existing_pending_job() {
        let running_job = Uuid::new_v4();
        let previous_pending = Uuid::new_v4();
        let mut queue = QueueState {
            running: Some(running_job),
            pending: Some(previous_pending),
        };
        let newer_pending = Uuid::new_v4();

        let decision = apply_enqueue(&mut queue, newer_pending);

        assert!(!decision.start_immediately);
        assert_eq!(decision.replaced_pending, Some(previous_pending));
        assert_eq!(queue.running, Some(running_job));
        assert_eq!(queue.pending, Some(newer_pending));
    }

    #[test]
    fn sensitive_path_detection_catches_expected_defaults() {
        assert!(is_sensitive_path(Path::new(".env")));
        assert!(is_sensitive_path(Path::new("nested/.env.production")));
        assert!(is_sensitive_path(Path::new("keys/id_rsa.pem")));
        assert!(is_sensitive_path(Path::new(".aws/credentials")));
        assert!(is_sensitive_path(Path::new("config/service-token.txt")));
        assert!(!is_sensitive_path(Path::new("src/lib.rs")));
    }

    #[cfg(unix)]
    #[test]
    fn indexable_file_metadata_rejects_symlinks() {
        use std::{fs, os::unix::fs::symlink};
        use tempfile::tempdir;

        let temp = tempdir().expect("create temp dir");
        let outside = tempdir().expect("create outside dir");
        let target = outside.path().join("secret.txt");
        fs::write(&target, "secret").expect("write target file");
        let link = temp.path().join("linked-secret.txt");
        symlink(&target, &link).expect("create symlink");

        assert!(indexable_file_metadata(&link).is_none());
    }
}
