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
use walkdir::WalkDir;

#[derive(Clone)]
struct AppState {
    root_dir: Arc<PathBuf>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    root_dir: String,
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

pub fn load_root_dir_from_env() -> Result<PathBuf, String> {
    let root_dir = env::var("EXPLORER_ROOT")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().expect("failed to get current directory"));

    root_dir
        .canonicalize()
        .map_err(|e| format!("EXPLORER_ROOT must point to an existing directory: {e}"))
}

pub fn build_app(root_dir: PathBuf) -> Router {
    let root_dir = root_dir.canonicalize().unwrap_or(root_dir);
    let state = AppState {
        root_dir: Arc::new(root_dir),
    };

    Router::new()
        .route("/health", get(health))
        .route("/api/tree", get(get_tree))
        .route("/api/file", get(get_file))
        .route("/api/search", get(search))
        .route("/api/ask", post(ask))
        .with_state(state)
        .layer(CorsLayer::permissive())
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        root_dir: state.root_dir.display().to_string(),
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
    for entry in fs::read_dir(&resolved).map_err(|e| AppError::internal(e.to_string()))? {
        let entry = entry.map_err(|e| AppError::internal(e.to_string()))?;
        let file_type = entry
            .file_type()
            .map_err(|e| AppError::internal(e.to_string()))?;
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

    entries.sort_by(|a, b| match (a.kind, b.kind) {
        ("directory", "file") => std::cmp::Ordering::Less,
        ("file", "directory") => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
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

    let metadata = fs::metadata(&resolved).map_err(|e| AppError::internal(e.to_string()))?;
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
    let search_path = resolve_within_root(&state.root_dir, query.path.as_deref())?;
    if !search_path.is_dir() {
        return Err(AppError::bad_request("search path must be a directory"));
    }

    let q = query.query.trim();
    if q.is_empty() {
        return Err(AppError::bad_request("query cannot be empty"));
    }

    let limit = query.limit.unwrap_or(30).min(100);
    let q_lower = q.to_lowercase();
    let mut matches = Vec::new();

    for entry in WalkDir::new(&search_path)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !entry.file_type().is_file() {
            continue;
        }
        if is_ignored(path) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.len() > 2_000_000 {
            continue;
        }

        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        if content.contains('\0') {
            continue;
        }

        for (index, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&q_lower) {
                matches.push(SearchMatch {
                    path: to_relative_path(&state.root_dir, path)?,
                    line_number: index + 1,
                    line: line.trim().to_string(),
                });
                if matches.len() >= limit {
                    return Ok(Json(SearchResponse {
                        query: q.to_string(),
                        matches,
                    }));
                }
            }
        }
    }

    Ok(Json(SearchResponse {
        query: q.to_string(),
        matches,
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
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|_| AppError::internal("failed to compute relative path"))
}

fn is_ignored(path: &Path) -> bool {
    let ignored_segments = [".git", "node_modules", "target", ".next", ".turbo"];
    path.components().any(|component| {
        let part = component.as_os_str().to_string_lossy();
        ignored_segments.contains(&part.as_ref())
    })
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
    fn ignored_segment_detection_works() {
        assert!(is_ignored(Path::new("repo/node_modules/pkg/index.js")));
        assert!(is_ignored(Path::new("repo/.git/config")));
        assert!(!is_ignored(Path::new("repo/src/lib.rs")));
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
}
