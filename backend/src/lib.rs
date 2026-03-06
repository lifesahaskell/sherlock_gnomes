use std::{
    collections::{HashMap, VecDeque},
    env, fs,
    path::{Component, Path as StdPath, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    body::Body,
    extract::{
        DefaultBodyLimit,
        Path as PathParam,
        Query,
        State,
    },
    http::{
        header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue},
        Method, Request, StatusCode,
    },
    middleware::{self, Next},
    response::IntoResponse,
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tower_http::cors::{AllowOrigin, CorsLayer};

mod indexing;

pub use indexing::fuzz_parse_semantic_blocks;
pub use indexing::IndexingService;
use indexing::{
    EnqueueIndexResponse, HybridSearch, IndexJobView, IndexStatusView, ProfileError, SearchError,
    UserProfile,
};

#[derive(Clone)]
struct AppState {
    root_dir: Arc<PathBuf>,
    indexing: Option<Arc<IndexingService>>,
    hybrid_search_enabled: bool,
    security: ApiSecurityConfig,
    rate_limiter: Arc<RateLimiter>,
}

#[derive(Clone)]
pub struct ApiSecurityConfig {
    enforce_auth: bool,
    read_api_key: Option<String>,
    admin_api_key: Option<String>,
    allowed_origins: Vec<HeaderValue>,
}

#[derive(Clone)]
struct RateLimiter {
    buckets: Arc<Mutex<HashMap<String, VecDeque<Instant>>>>,
}

#[derive(Clone, Copy)]
enum ApiScope {
    Read,
    Admin,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    root_dir: String,
    indexed_search_enabled: bool,
    hybrid_search_enabled: bool,
}

const API_BODY_LIMIT_BYTES: usize = 16 * 1024;
const API_QUERY_MAX_CHARACTERS: usize = 2_048;
const API_PATH_MAX_CHARACTERS: usize = 1_024;
const API_QUESTION_MAX_CHARACTERS: usize = 2_000;
const API_ASK_PATH_LIMIT: usize = 8;
const SEARCH_LIMIT_DEFAULT: usize = 30;
const SEARCH_LIMIT_MAX: usize = 100;
const FILE_PREVIEW_LINES: usize = 30;
const READ_RATELIMIT_PER_MINUTE: usize = 60;
const ADMIN_RATELIMIT_PER_MINUTE: usize = 15;
const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);
const DEFAULT_ALLOWED_ORIGINS: [&str; 2] = ["http://127.0.0.1:3000", "http://localhost:3000"];

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

#[derive(Deserialize)]
struct CreateProfileRequest {
    display_name: String,
    email: String,
    bio: Option<String>,
}

#[derive(Deserialize)]
struct UpdateProfileRequest {
    display_name: Option<String>,
    email: Option<String>,
    bio: Option<String>,
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

pub fn load_hybrid_search_enabled_from_env() -> bool {
    env::var("HYBRID_SEARCH_ENABLED")
        .ok()
        .and_then(|value| parse_env_bool(&value))
        .unwrap_or(true)
}

pub fn load_api_security_config() -> ApiSecurityConfig {
    let auth_disabled = env::var("EXPLORER_AUTH_DISABLED")
        .ok()
        .and_then(|value| parse_env_bool(&value))
        .unwrap_or(false);

    ApiSecurityConfig {
        enforce_auth: !auth_disabled,
        read_api_key: env::var("EXPLORER_READ_API_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string()),
        admin_api_key: env::var("EXPLORER_ADMIN_API_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string()),
        allowed_origins: load_allowed_origins_from_env(),
    }
}

fn load_allowed_origins_from_env() -> Vec<HeaderValue> {
    let from_env = env::var("EXPLORER_ALLOWED_ORIGINS")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let configured = from_env
        .map(|value| {
            value
                .split(',')
                .map(|item| item.trim())
                .filter(|item| !item.is_empty())
                .filter_map(|item| item.parse::<HeaderValue>().ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if configured.is_empty() {
        default_allowed_origins()
    } else {
        configured
    }
}

fn default_allowed_origins() -> Vec<HeaderValue> {
    DEFAULT_ALLOWED_ORIGINS
        .into_iter()
        .map(|item| item.parse().expect("failed to parse default allowed origin"))
        .collect()
}

pub fn validate_runtime_security_config(config: &ApiSecurityConfig) -> Result<(), String> {
    if !config.enforce_auth {
        return Ok(());
    }

    if config.read_api_key.is_none() {
        return Err(
            "EXPLORER_READ_API_KEY is required when authentication is enabled".to_string(),
        );
    }

    if config.admin_api_key.is_none() {
        return Err(
            "EXPLORER_ADMIN_API_KEY is required when authentication is enabled".to_string(),
        );
    }

    Ok(())
}

impl ApiSecurityConfig {
    pub fn with_keys(read_api_key: impl Into<String>, admin_api_key: impl Into<String>) -> Self {
        Self {
            enforce_auth: true,
            read_api_key: Some(read_api_key.into()),
            admin_api_key: Some(admin_api_key.into()),
            allowed_origins: default_allowed_origins(),
        }
    }

    pub fn auth_enforced(&self) -> bool {
        self.enforce_auth
    }
}

pub fn build_app(root_dir: PathBuf) -> Router {
    build_app_with_indexing_and_hybrid_toggle(root_dir, None, true)
}

pub fn build_app_with_indexing(root_dir: PathBuf, indexing: Option<IndexingService>) -> Router {
    build_app_with_indexing_and_hybrid_toggle(root_dir, indexing, true)
}

pub fn build_app_with_indexing_and_hybrid_toggle(
    root_dir: PathBuf,
    indexing: Option<IndexingService>,
    hybrid_search_enabled: bool,
) -> Router {
    build_app_with_indexing_and_hybrid_toggle_and_security(
        root_dir,
        indexing,
        hybrid_search_enabled,
        load_api_security_config(),
    )
}

pub fn build_app_with_indexing_and_hybrid_toggle_and_security(
    root_dir: PathBuf,
    indexing: Option<IndexingService>,
    hybrid_search_enabled: bool,
    security: ApiSecurityConfig,
) -> Router {
    let root_dir = root_dir.canonicalize().unwrap_or(root_dir);
    let state = AppState {
        root_dir: Arc::new(root_dir),
        indexing: indexing.map(Arc::new),
        hybrid_search_enabled,
        security: security.clone(),
        rate_limiter: Arc::new(RateLimiter::new()),
    };
    let api_key_header = HeaderName::from_static("x-api-key");
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(state.security.allowed_origins.clone()))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::OPTIONS])
        .allow_headers([CONTENT_TYPE, AUTHORIZATION, api_key_header]);

    Router::new()
        .route("/health", get(health))
        .route("/api/tree", get(get_tree))
        .route("/api/file", get(get_file))
        .route("/api/search", get(search))
        .route("/api/search/hybrid", get(search_hybrid))
        .route("/api/index", post(start_indexing))
        .route("/api/index/status", get(index_status))
        .route("/api/profiles", get(list_profiles).post(create_profile))
        .route("/api/profiles/{id}", put(update_profile))
        .route("/api/ask", post(ask))
        .with_state(state.clone())
        .route_layer(middleware::from_fn_with_state(
            state,
            enforce_auth_and_rate_limit,
        ))
        .layer(DefaultBodyLimit::max(API_BODY_LIMIT_BYTES))
        .layer(cors)
}

async fn enforce_auth_and_rate_limit(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> axum::response::Response {
    if request.method() == Method::OPTIONS {
        return next.run(request).await;
    }

    let path = request.uri().path();
    let route_scope = api_scope_for_request(request.method(), path);

    if let Some(scope) = route_scope {
        if let Err(error) = validate_api_access(&state.security, request.headers(), scope) {
            return error.into_response();
        }

        let identifier = request_client_id(&request);
        let (limit, window) = match scope {
            ApiScope::Read => (READ_RATELIMIT_PER_MINUTE, RATE_LIMIT_WINDOW),
            ApiScope::Admin => (ADMIN_RATELIMIT_PER_MINUTE, RATE_LIMIT_WINDOW),
        };

        if !state
            .rate_limiter
            .check(scope.rate_limit_key(&identifier), limit, window)
            .await
        {
            return AppError::too_many_requests("rate limit exceeded").into_response();
        }
    }

    next.run(request).await
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            buckets: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn check(&self, key: String, limit: usize, window: Duration) -> bool {
        let now = Instant::now();
        let mut buckets = self.buckets.lock().await;
        let bucket = buckets.entry(key).or_default();

        while let Some(oldest) = bucket.front().copied() {
            if now.duration_since(oldest) <= window {
                break;
            }
            bucket.pop_front();
        }

        if bucket.len() >= limit {
            return false;
        }

        bucket.push_back(now);
        true
    }
}

impl ApiScope {
    fn rate_limit_key(self, identifier: &str) -> String {
        let scope = match self {
            ApiScope::Read => "read",
            ApiScope::Admin => "admin",
        };
        format!("{scope}:{identifier}")
    }
}

fn api_scope_for_request(method: &Method, path: &str) -> Option<ApiScope> {
    if !path.starts_with("/api/") {
        return None;
    }

    if path == "/api/index" && *method == Method::POST {
        return Some(ApiScope::Admin);
    }

    if path.starts_with("/api/profiles") {
        return match *method {
            Method::GET => Some(ApiScope::Read),
            Method::POST | Method::PUT => Some(ApiScope::Admin),
            _ => None,
        };
    }

    Some(ApiScope::Read)
}

fn validate_api_access(
    config: &ApiSecurityConfig,
    headers: &HeaderMap,
    scope: ApiScope,
) -> Result<(), AppError> {
    if !config.enforce_auth {
        return Ok(());
    }

    let Some(provided) = provided_auth_credential(headers) else {
        return Err(AppError::unauthorized("missing API credential"));
    };

    let matches_read = configured_key_matches(&config.read_api_key, provided);
    let matches_admin = configured_key_matches(&config.admin_api_key, provided);

    match scope {
        ApiScope::Read => {
            if matches_read || matches_admin {
                Ok(())
            } else {
                Err(AppError::unauthorized("invalid API credential"))
            }
        }
        ApiScope::Admin => {
            if matches_admin {
                Ok(())
            } else if matches_read {
                Err(AppError::forbidden("admin API key required"))
            } else {
                Err(AppError::unauthorized("invalid API credential"))
            }
        }
    }
}

fn provided_auth_credential(headers: &HeaderMap) -> Option<&str> {
    if let Some(api_key) = headers.get("x-api-key").and_then(|value| value.to_str().ok()) {
        let trimmed = api_key.trim();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }

    let auth_header = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())?;
    let token = auth_header
        .strip_prefix("Bearer ")
        .or_else(|| auth_header.strip_prefix("bearer "))?
        .trim();

    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

fn configured_key_matches(configured: &Option<String>, provided: &str) -> bool {
    configured
        .as_deref()
        .is_some_and(|configured| configured == provided)
}

fn request_client_id(request: &Request<Body>) -> String {
    if let Some(forwarded) = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
    {
        let first = forwarded.split(',').next().unwrap_or_default().trim();
        if !first.is_empty() {
            return first.to_string();
        }
    }

    if let Some(real_ip) = request
        .headers()
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
    {
        let trimmed = real_ip.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    "unknown".to_string()
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        root_dir: state.root_dir.display().to_string(),
        indexed_search_enabled: state.indexing.is_some(),
        hybrid_search_enabled: state.hybrid_search_enabled,
    })
}

async fn get_tree(
    State(state): State<AppState>,
    Query(query): Query<TreeQuery>,
) -> Result<Json<TreeResponse>, AppError> {
    validate_optional_relative_path(query.path.as_deref())?;
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
    if query.path.trim().is_empty() {
        return Err(AppError::bad_request("path cannot be empty"));
    }

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
    let q = query.query.trim();
    if q.is_empty() {
        return Err(AppError::bad_request("query cannot be empty"));
    }
    if q.chars().count() > API_QUERY_MAX_CHARACTERS {
        return Err(AppError::bad_request(format!(
            "query must be {API_QUERY_MAX_CHARACTERS} characters or fewer"
        )));
    }

    validate_filter_path(query.path.as_deref())?;

    let limit = validate_search_limit(query.limit)?;
    let service = indexing_service(&state)?;
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
    if !state.hybrid_search_enabled {
        return Err(AppError::not_found("hybrid search is disabled"));
    }

    let q = query.query.trim();
    if q.is_empty() {
        return Err(AppError::bad_request("query cannot be empty"));
    }
    if q.chars().count() > API_QUERY_MAX_CHARACTERS {
        return Err(AppError::bad_request(format!(
            "query must be {API_QUERY_MAX_CHARACTERS} characters or fewer"
        )));
    }

    validate_filter_path(query.path.as_deref())?;

    let limit = validate_search_limit(query.limit)?;
    let service = indexing_service(&state)?;
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

async fn create_profile(
    State(state): State<AppState>,
    Json(request): Json<CreateProfileRequest>,
) -> Result<(StatusCode, Json<UserProfile>), AppError> {
    let (display_name, email, bio) = validate_create_profile_request(request)?;
    let service = indexing_service(&state)?;
    let profile = service
        .create_profile(&display_name, &email, &bio)
        .await
        .map_err(app_error_from_profile)?;

    Ok((StatusCode::CREATED, Json(profile)))
}

async fn list_profiles(State(state): State<AppState>) -> Result<Json<Vec<UserProfile>>, AppError> {
    let service = indexing_service(&state)?;
    let profiles = service
        .list_profiles()
        .await
        .map_err(app_error_from_profile)?;

    Ok(Json(profiles))
}

async fn update_profile(
    PathParam(profile_id): PathParam<i64>,
    State(state): State<AppState>,
    Json(request): Json<UpdateProfileRequest>,
) -> Result<Json<UserProfile>, AppError> {
    let (display_name, email, bio) = validate_update_profile_request(request)?;
    let service = indexing_service(&state)?;
    let profile = service
        .update_profile(
            profile_id,
            display_name.as_deref(),
            email.as_deref(),
            bio.as_deref(),
        )
        .await
        .map_err(app_error_from_profile)?;

    Ok(Json(profile))
}

async fn ask(
    State(state): State<AppState>,
    Json(request): Json<AskRequest>,
) -> Result<Json<AskResponse>, AppError> {
    let question = request.question.trim();
    if question.is_empty() {
        return Err(AppError::bad_request("question cannot be empty"));
    }
    if question.chars().count() > API_QUESTION_MAX_CHARACTERS {
        return Err(AppError::bad_request(format!(
            "question must be {API_QUESTION_MAX_CHARACTERS} characters or fewer"
        )));
    }

    if request.paths.is_empty() {
        return Err(AppError::bad_request(
            "paths cannot be empty; provide files to build context",
        ));
    }
    if request.paths.len() > API_ASK_PATH_LIMIT {
        return Err(AppError::bad_request(format!(
            "paths must include at most {API_ASK_PATH_LIMIT} entries"
        )));
    }

    let mut context = Vec::new();
    for path in request.paths.iter().take(API_ASK_PATH_LIMIT) {
        let resolved = resolve_within_root(&state.root_dir, Some(path))?;
        if !resolved.is_file() {
            continue;
        }
        let Ok(content) = fs::read_to_string(&resolved) else {
            continue;
        };
        let preview = content
            .lines()
            .take(FILE_PREVIEW_LINES)
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

fn app_error_from_profile(error: ProfileError) -> AppError {
    match error {
        ProfileError::DuplicateEmail => AppError::conflict(error.message()),
        ProfileError::NotFound => AppError::not_found(error.message()),
        ProfileError::Message(message) => AppError::internal(message),
    }
}

fn validate_create_profile_request(
    request: CreateProfileRequest,
) -> Result<(String, String, String), AppError> {
    let display_name = request.display_name.trim();
    if display_name.is_empty() {
        return Err(AppError::bad_request("display_name cannot be empty"));
    }
    if display_name.chars().count() > 80 {
        return Err(AppError::bad_request(
            "display_name must be 80 characters or fewer",
        ));
    }

    let email = request.email.trim().to_ascii_lowercase();
    if email.is_empty() {
        return Err(AppError::bad_request("email cannot be empty"));
    }
    if email.len() > 254 || !is_likely_email(&email) {
        return Err(AppError::bad_request("email must be a valid email address"));
    }

    let bio = request.bio.unwrap_or_default().trim().to_string();
    if bio.chars().count() > 500 {
        return Err(AppError::bad_request("bio must be 500 characters or fewer"));
    }

    Ok((display_name.to_string(), email, bio))
}

type ProfileUpdateFields = (Option<String>, Option<String>, Option<String>);

fn validate_update_profile_request(
    request: UpdateProfileRequest,
) -> Result<ProfileUpdateFields, AppError> {
    let mut display_name = None;
    let mut email = None;
    let mut bio = None;

    if let Some(value) = request.display_name {
        let normalized = value.trim();
        if normalized.is_empty() {
            return Err(AppError::bad_request("display_name cannot be empty"));
        }
        if normalized.chars().count() > 80 {
            return Err(AppError::bad_request(
                "display_name must be 80 characters or fewer",
            ));
        }
        display_name = Some(normalized.to_string());
    }

    if let Some(value) = request.email {
        let normalized = value.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            return Err(AppError::bad_request("email cannot be empty"));
        }
        if normalized.len() > 254 || !is_likely_email(&normalized) {
            return Err(AppError::bad_request("email must be a valid email address"));
        }
        email = Some(normalized);
    }

    if let Some(value) = request.bio {
        let normalized = value.trim().to_string();
        if normalized.chars().count() > 500 {
            return Err(AppError::bad_request("bio must be 500 characters or fewer"));
        }
        bio = Some(normalized);
    }

    if display_name.is_none() && email.is_none() && bio.is_none() {
        return Err(AppError::bad_request(
            "at least one profile field must be provided",
        ));
    }

    Ok((display_name, email, bio))
}

fn is_likely_email(value: &str) -> bool {
    let (local, domain) = match value.split_once('@') {
        Some(parts) => parts,
        None => return false,
    };
    if local.is_empty() || domain.is_empty() {
        return false;
    }
    domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

fn validate_filter_path(path: Option<&str>) -> Result<(), AppError> {
    if let Some(value) = path {
        if value.chars().count() > API_PATH_MAX_CHARACTERS {
            return Err(AppError::bad_request(format!(
                "path must be {API_PATH_MAX_CHARACTERS} characters or fewer"
            )));
        }

        let relative = StdPath::new(value);
        if relative.is_absolute() || contains_parent_dir(relative) {
            return Err(AppError::bad_request(
                "path must be relative and cannot contain parent traversal",
            ));
        }
    }

    Ok(())
}

fn resolve_within_root(root: &StdPath, requested: Option<&str>) -> Result<PathBuf, AppError> {
    match requested {
        None => Ok(root.to_path_buf()),
        Some(path) => {
            if path.chars().count() > API_PATH_MAX_CHARACTERS {
                return Err(AppError::bad_request(format!(
                    "path must be {API_PATH_MAX_CHARACTERS} characters or fewer"
                )));
            }

            let relative = StdPath::new(path);
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

fn contains_parent_dir(path: &StdPath) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn parse_env_bool(value: &str) -> Option<bool> {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn to_relative_path(root: &StdPath, full_path: &StdPath) -> Result<String, AppError> {
    full_path
        .strip_prefix(root)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|_| AppError::internal("failed to compute relative path"))
}

fn validate_optional_relative_path(path: Option<&str>) -> Result<(), AppError> {
    if let Some(value) = path {
        if value.chars().count() > API_PATH_MAX_CHARACTERS {
            return Err(AppError::bad_request(format!(
                "path must be {API_PATH_MAX_CHARACTERS} characters or fewer"
            )));
        }
    }
    Ok(())
}

fn validate_search_limit(limit: Option<usize>) -> Result<usize, AppError> {
    match limit {
        None => Ok(SEARCH_LIMIT_DEFAULT),
        Some(value) if (1..=SEARCH_LIMIT_MAX).contains(&value) => Ok(value),
        Some(_) => Err(AppError::bad_request(format!(
            "limit must be between 1 and {SEARCH_LIMIT_MAX}"
        ))),
    }
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

    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.into(),
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
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

    fn too_many_requests(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::TOO_MANY_REQUESTS,
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
    use proptest::prelude::*;
    use std::fs;
    use tempfile::tempdir;

    fn safe_relative_path_strategy() -> impl Strategy<Value = String> {
        prop::collection::vec("[A-Za-z0-9_]{1,12}", 1..6).prop_map(|parts| parts.join("/"))
    }

    #[test]
    fn parent_dir_detection_works() {
        assert!(contains_parent_dir(StdPath::new("../secret.txt")));
        assert!(contains_parent_dir(StdPath::new("src/../main.rs")));
        assert!(!contains_parent_dir(StdPath::new("src/main.rs")));
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

    #[test]
    fn parse_env_bool_accepts_common_values() {
        assert_eq!(parse_env_bool("true"), Some(true));
        assert_eq!(parse_env_bool("1"), Some(true));
        assert_eq!(parse_env_bool("yes"), Some(true));
        assert_eq!(parse_env_bool("off"), Some(false));
        assert_eq!(parse_env_bool("0"), Some(false));
        assert_eq!(parse_env_bool("no"), Some(false));
    }

    #[test]
    fn parse_env_bool_rejects_unknown_values() {
        assert_eq!(parse_env_bool(""), None);
        assert_eq!(parse_env_bool("banana"), None);
    }

    #[test]
    fn create_profile_validation_trims_and_normalizes_fields() {
        let request = CreateProfileRequest {
            display_name: "  Ada Lovelace ".to_string(),
            email: "  ADA@EXAMPLE.COM ".to_string(),
            bio: Some("  First programmer.  ".to_string()),
        };

        let (display_name, email, bio) =
            validate_create_profile_request(request).expect("validate profile request");
        assert_eq!(display_name, "Ada Lovelace");
        assert_eq!(email, "ada@example.com");
        assert_eq!(bio, "First programmer.");
    }

    #[test]
    fn create_profile_validation_rejects_invalid_email() {
        let request = CreateProfileRequest {
            display_name: "Ada".to_string(),
            email: "invalid-email".to_string(),
            bio: None,
        };

        let result = validate_create_profile_request(request);
        assert!(result.is_err());
    }

    #[test]
    fn create_profile_validation_rejects_long_bio() {
        let request = CreateProfileRequest {
            display_name: "Ada".to_string(),
            email: "ada@example.com".to_string(),
            bio: Some("x".repeat(501)),
        };

        let result = validate_create_profile_request(request);
        assert!(result.is_err());
    }

    proptest! {
        #[test]
        fn validate_filter_path_accepts_safe_relative_paths(path in safe_relative_path_strategy()) {
            prop_assert!(validate_filter_path(Some(&path)).is_ok());
        }

        #[test]
        fn validate_filter_path_rejects_absolute_paths(segment in "[A-Za-z0-9_]{1,12}") {
            let absolute = format!("/{segment}");
            prop_assert!(validate_filter_path(Some(&absolute)).is_err());
        }

        #[test]
        fn validate_filter_path_rejects_parent_segments(segment in "[A-Za-z0-9_]{1,12}") {
            let escaped = format!("{segment}/../escape");
            prop_assert!(validate_filter_path(Some(&escaped)).is_err());
        }
    }
}
