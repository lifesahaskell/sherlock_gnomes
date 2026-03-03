use std::{
    env, fs,
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;

mod indexing;

use indexing::{
    EnqueueIndexResponse, HybridSearch, IndexJobView, IndexStatusView, IndexingService, SearchError,
};

#[derive(Clone)]
struct AppState {
    root_dir: Arc<PathBuf>,
    indexing: Option<Arc<IndexingService>>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    root_dir: String,
    indexed_search_enabled: bool,
}

#[derive(Deserialize)]
struct TreeQuery {
    path: Option<String>,
}

#[derive(Serialize)]
struct TreeResponse {
    path: String,
    entries: Vec<TreeEntry>,
}

#[derive(Serialize)]
struct TreeEntry {
    name: String,
    path: String,
    kind: &'static str,
}

#[derive(Deserialize)]
struct FileQuery {
    path: String,
}

#[derive(Serialize)]
struct FileResponse {
    path: String,
    content: String,
}

#[derive(Deserialize)]
struct SearchQuery {
    query: String,
    path: Option<String>,
    limit: Option<usize>,
}

#[derive(Serialize)]
struct SearchResponse {
    query: String,
    matches: Vec<SearchMatch>,
}

#[derive(Serialize)]
struct SearchMatch {
    path: String,
    line_number: usize,
    line: String,
}

#[derive(Serialize)]
struct HybridSearchResponse {
    query: String,
    warnings: Vec<String>,
    matches: Vec<HybridSearchMatch>,
}

#[derive(Serialize)]
struct HybridSearchMatch {
    path: String,
    start_line: usize,
    end_line: usize,
    snippet: String,
    score: f64,
    sources: Vec<String>,
}

#[derive(Deserialize)]
struct AskRequest {
    question: String,
    paths: Vec<String>,
}

#[derive(Serialize)]
struct AskResponse {
    guidance: String,
    context: Vec<FileContext>,
}

#[derive(Serialize)]
struct FileContext {
    path: String,
    preview: String,
}

#[derive(Serialize)]
struct IndexStatusResponse {
    current_job: Option<IndexJobView>,
    pending: bool,
    last_completed_job: Option<IndexJobView>,
}

pub fn load_root_dir_from_env() -> Result<PathBuf, String> {
    let root_dir = env::var("EXPLORER_ROOT")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().expect("failed to get current directory"));

    root_dir
        .canonicalize()
        .map_err(|error| format!("EXPLORER_ROOT must point to an existing directory: {error}"))
}

pub async fn load_indexing_from_env(
    root_dir: Arc<PathBuf>,
) -> Result<Option<IndexingService>, String> {
    IndexingService::from_env(root_dir).await
}

pub fn build_app(root_dir: PathBuf) -> Router {
    build_app_with_indexing(root_dir, None)
}

pub fn build_app_with_indexing(root_dir: PathBuf, indexing: Option<IndexingService>) -> Router {
    let root_dir = root_dir.canonicalize().unwrap_or(root_dir);
    let state = AppState {
        root_dir: Arc::new(root_dir),
        indexing: indexing.map(Arc::new),
    };

    Router::new()
        .route("/health", get(health))
        .route("/api/tree", get(get_tree))
        .route("/api/file", get(get_file))
        .route("/api/search", get(search))
        .route("/api/search/hybrid", get(search_hybrid))
        .route("/api/index", post(start_indexing))
        .route("/api/index/status", get(index_status))
        .route("/api/ask", post(ask))
        .with_state(state)
        .layer(CorsLayer::permissive())
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        root_dir: state.root_dir.display().to_string(),
        indexed_search_enabled: state.indexing.is_some(),
    })
}

async fn get_tree(
    State(state): State<AppState>,
    Query(query): Query<TreeQuery>,
) -> Result<Json<TreeResponse>, AppError> {
    let resolved = resolve_within_root(&state.root_dir, query.path.as_deref())?;
    if !resolved.is_dir() {
        return Err(AppError::bad_request("path is not a directory"));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&resolved).map_err(|error| AppError::internal(error.to_string()))? {
        let entry = entry.map_err(|error| AppError::internal(error.to_string()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| AppError::internal(error.to_string()))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let relative_path = to_relative_path(&state.root_dir, &entry.path())?;
        entries.push(TreeEntry {
            name,
            path: relative_path,
            kind: if file_type.is_dir() {
                "directory"
            } else {
                "file"
            },
        });
    }

    entries.sort_by(|left, right| match (left.kind, right.kind) {
        ("directory", "file") => std::cmp::Ordering::Less,
        ("file", "directory") => std::cmp::Ordering::Greater,
        _ => left.name.cmp(&right.name),
    });

    Ok(Json(TreeResponse {
        path: to_relative_path(&state.root_dir, &resolved)?,
        entries,
    }))
}

async fn get_file(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
) -> Result<Json<FileResponse>, AppError> {
    let resolved = resolve_within_root(&state.root_dir, Some(&query.path))?;
    if !resolved.is_file() {
        return Err(AppError::bad_request("path is not a file"));
    }

    let metadata =
        fs::metadata(&resolved).map_err(|error| AppError::internal(error.to_string()))?;
    if metadata.len() > 500_000 {
        return Err(AppError::bad_request(
            "file is too large to display (max 500KB)",
        ));
    }

    let content = fs::read_to_string(&resolved)
        .map_err(|_| AppError::bad_request("file is not valid UTF-8 text"))?;

    Ok(Json(FileResponse {
        path: to_relative_path(&state.root_dir, &resolved)?,
        content,
    }))
}

async fn search(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<SearchResponse>, AppError> {
    let service = indexing_service(&state)?;

    let q = query.query.trim();
    if q.is_empty() {
        return Err(AppError::bad_request("query cannot be empty"));
    }

    validate_filter_path(query.path.as_deref())?;

    let limit = query.limit.unwrap_or(30).min(100);
    let matches = service
        .keyword_search(q, query.path.as_deref(), limit)
        .await
        .map_err(app_error_from_search)?;

    Ok(Json(SearchResponse {
        query: q.to_string(),
        matches: matches
            .into_iter()
            .map(|item| SearchMatch {
                path: item.path,
                line_number: item.line_number,
                line: item.line,
            })
            .collect(),
    }))
}

async fn search_hybrid(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<HybridSearchResponse>, AppError> {
    let service = indexing_service(&state)?;

    let q = query.query.trim();
    if q.is_empty() {
        return Err(AppError::bad_request("query cannot be empty"));
    }

    validate_filter_path(query.path.as_deref())?;

    let limit = query.limit.unwrap_or(30).min(100);
    let HybridSearch { warnings, matches } = service
        .hybrid_search(q, query.path.as_deref(), limit)
        .await
        .map_err(app_error_from_search)?;

    Ok(Json(HybridSearchResponse {
        query: q.to_string(),
        warnings,
        matches: matches
            .into_iter()
            .map(|item| HybridSearchMatch {
                path: item.path,
                start_line: item.start_line,
                end_line: item.end_line,
                snippet: item.snippet,
                score: item.score,
                sources: item.sources,
            })
            .collect(),
    }))
}

async fn start_indexing(
    State(state): State<AppState>,
    Json(_request): Json<serde_json::Value>,
) -> Result<(StatusCode, Json<EnqueueIndexResponse>), AppError> {
    let service = indexing_service(&state)?;
    let response = service.enqueue_index().await.map_err(AppError::internal)?;

    Ok((StatusCode::ACCEPTED, Json(response)))
}

async fn index_status(
    State(state): State<AppState>,
) -> Result<Json<IndexStatusResponse>, AppError> {
    let service = indexing_service(&state)?;
    let IndexStatusView {
        current_job,
        pending,
        last_completed_job,
    } = service.status().await.map_err(AppError::internal)?;

    Ok(Json(IndexStatusResponse {
        current_job,
        pending,
        last_completed_job,
    }))
}

async fn ask(
    State(state): State<AppState>,
    Json(request): Json<AskRequest>,
) -> Result<Json<AskResponse>, AppError> {
    let question = request.question.trim();
    if question.is_empty() {
        return Err(AppError::bad_request("question cannot be empty"));
    }

    if request.paths.is_empty() {
        return Err(AppError::bad_request(
            "paths cannot be empty; provide files to build context",
        ));
    }

    let mut context = Vec::new();
    for path in request.paths.iter().take(8) {
        let resolved = resolve_within_root(&state.root_dir, Some(path))?;
        if !resolved.is_file() {
            continue;
        }
        let Ok(content) = fs::read_to_string(&resolved) else {
            continue;
        };
        let preview = content
            .lines()
            .take(30)
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();

        context.push(FileContext {
            path: to_relative_path(&state.root_dir, &resolved)?,
            preview,
        });
    }

    let guidance = format!(
        "Use the selected file previews as context for this question: \"{}\". \
        Send the question and context to your preferred LLM provider from the frontend or a worker service.",
        question
    );

    Ok(Json(AskResponse { guidance, context }))
}

fn indexing_service(state: &AppState) -> Result<Arc<IndexingService>, AppError> {
    state.indexing.clone().ok_or_else(|| {
        AppError::service_unavailable(
            "DATABASE_URL is required for indexed search and indexing endpoints",
        )
    })
}

fn app_error_from_search(error: SearchError) -> AppError {
    match error {
        SearchError::NoIndex => AppError::conflict(error.message()),
        SearchError::Message(message) => AppError::internal(message),
    }
}

fn validate_filter_path(path: Option<&str>) -> Result<(), AppError> {
    if let Some(value) = path {
        let relative = Path::new(value);
        if relative.is_absolute() || contains_parent_dir(relative) {
            return Err(AppError::bad_request(
                "path must be relative and cannot contain parent traversal",
            ));
        }
    }

    Ok(())
}

fn resolve_within_root(root: &Path, requested: Option<&str>) -> Result<PathBuf, AppError> {
    match requested {
        None => Ok(root.to_path_buf()),
        Some(path) => {
            let relative = Path::new(path);
            if relative.is_absolute() || contains_parent_dir(relative) {
                return Err(AppError::bad_request(
                    "path must be relative and cannot contain parent traversal",
                ));
            }
            let joined = root.join(relative);
            let canonical = joined
                .canonicalize()
                .map_err(|_| AppError::bad_request("path does not exist"))?;
            if !canonical.starts_with(root) {
                return Err(AppError::bad_request("path escapes configured root"));
            }
            Ok(canonical)
        }
    }
}

fn contains_parent_dir(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn to_relative_path(root: &Path, full_path: &Path) -> Result<String, AppError> {
    full_path
        .strip_prefix(root)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|_| AppError::internal("failed to compute relative path"))
}

#[derive(Debug)]
struct AppError {
    status: StatusCode,
    message: String,
}

impl AppError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
        }
    }

    fn service_unavailable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let payload = serde_json::json!({ "error": self.message });
        (self.status, Json(payload)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn parent_dir_detection_works() {
        assert!(contains_parent_dir(Path::new("../secret.txt")));
        assert!(contains_parent_dir(Path::new("src/../main.rs")));
        assert!(!contains_parent_dir(Path::new("src/main.rs")));
    }

    #[test]
    fn relative_path_conversion_handles_root_and_nested() {
        let temp = tempdir().expect("create temp dir");
        let root = temp.path().canonicalize().expect("canonicalize root");
        let nested_dir = root.join("nested");
        fs::create_dir_all(&nested_dir).expect("create nested dir");
        let nested_file = nested_dir.join("file.txt");
        fs::write(&nested_file, "hello").expect("write file");

        let root_relative = to_relative_path(&root, &root).expect("relative root");
        let file_relative = to_relative_path(&root, &nested_file).expect("relative file");

        assert_eq!(root_relative, "");
        assert_eq!(file_relative, "nested/file.txt");
    }

    #[test]
    fn resolve_within_root_rejects_parent_traversal() {
        let temp = tempdir().expect("create temp dir");
        let root = temp.path().canonicalize().expect("canonicalize root");
        let result = resolve_within_root(&root, Some("../outside.txt"));
        assert!(result.is_err());
    }

    #[test]
    fn resolve_within_root_accepts_existing_relative_path() {
        let temp = tempdir().expect("create temp dir");
        let root = temp.path().canonicalize().expect("canonicalize root");
        let file = root.join("good.txt");
        fs::write(&file, "ok").expect("write file");

        let resolved = resolve_within_root(&root, Some("good.txt")).expect("resolve path");
        assert_eq!(resolved, file.canonicalize().expect("canonicalize file"));
    }

    #[test]
    fn validate_filter_path_rejects_parent_traversal() {
        let result = validate_filter_path(Some("src/../secrets"));
        assert!(result.is_err());
    }
}
