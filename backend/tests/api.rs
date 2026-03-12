use std::{fs, path::PathBuf, sync::Arc, time::Duration};

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use codebase_explorer_backend::{
    ApiSecurityConfig, IndexingService, build_app_with_indexing_and_hybrid_toggle_and_security,
    load_indexing_from_env,
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use serial_test::serial;
use sqlx::PgPool;
use tempfile::tempdir;
use tower::ServiceExt;

const TEST_READ_API_KEY: &str = "test-read-api-key";
const TEST_ADMIN_API_KEY: &str = "test-admin-api-key";

async fn body_json(body: Body) -> Value {
    let bytes = body.collect().await.expect("collect body bytes").to_bytes();
    serde_json::from_slice(&bytes).expect("parse response JSON")
}

fn build_app(root_dir: PathBuf) -> Router {
    build_app_with_indexing_and_hybrid_toggle_and_security(
        root_dir,
        None,
        true,
        ApiSecurityConfig::with_keys(TEST_READ_API_KEY, TEST_ADMIN_API_KEY),
    )
}

fn build_app_with_indexing(root_dir: PathBuf, indexing: Option<IndexingService>) -> Router {
    build_app_with_indexing_and_hybrid_toggle_and_security(
        root_dir,
        indexing,
        true,
        ApiSecurityConfig::with_keys(TEST_READ_API_KEY, TEST_ADMIN_API_KEY),
    )
}

fn build_app_with_indexing_and_hybrid_toggle(
    root_dir: PathBuf,
    indexing: Option<IndexingService>,
    hybrid_search_enabled: bool,
) -> Router {
    build_app_with_indexing_and_hybrid_toggle_and_security(
        root_dir,
        indexing,
        hybrid_search_enabled,
        ApiSecurityConfig::with_keys(TEST_READ_API_KEY, TEST_ADMIN_API_KEY),
    )
}

fn unauthenticated_get_request(uri: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(uri)
        .body(Body::empty())
        .expect("build GET request")
}

fn get_request(uri: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(uri)
        .header("x-api-key", TEST_READ_API_KEY)
        .body(Body::empty())
        .expect("build GET request")
}

fn options_request(uri: &str, origin: &str) -> Request<Body> {
    Request::builder()
        .method("OPTIONS")
        .uri(uri)
        .header("origin", origin)
        .header("access-control-request-method", "GET")
        .header("access-control-request-headers", "content-type")
        .body(Body::empty())
        .expect("build OPTIONS request")
}

fn post_request(uri: &str, payload: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("x-api-key", TEST_ADMIN_API_KEY)
        .header("content-type", "application/json")
        .body(Body::from(payload.to_string()))
        .expect("build POST request")
}

fn post_request_with_key(uri: &str, payload: Value, api_key: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("x-api-key", api_key)
        .header("content-type", "application/json")
        .body(Body::from(payload.to_string()))
        .expect("build POST request")
}

fn unauthenticated_post_request(uri: &str, payload: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(payload.to_string()))
        .expect("build POST request")
}

fn put_request(uri: &str, payload: Value) -> Request<Body> {
    Request::builder()
        .method("PUT")
        .uri(uri)
        .header("x-api-key", TEST_ADMIN_API_KEY)
        .header("content-type", "application/json")
        .body(Body::from(payload.to_string()))
        .expect("build PUT request")
}

fn set_test_env_var(key: &str, value: &str) {
    // SAFETY: These calls are constrained to serial integration tests that intentionally
    // control process-level environment to exercise env-driven runtime behavior.
    unsafe {
        std::env::set_var(key, value);
    }
}

fn configure_mock_indexing_env(database_url: &str) {
    set_test_env_var("DATABASE_URL", database_url);
    set_test_env_var("EMBEDDING_PROVIDER", "mock");
}

async fn wait_for_indexing_completion(app: &Router, failure_context: &str, timeout_message: &str) {
    for _ in 0..30 {
        let status_response = app
            .clone()
            .oneshot(get_request("/api/index/status"))
            .await
            .expect("send index status request");
        assert_eq!(status_response.status(), StatusCode::OK);
        let status_payload = body_json(status_response.into_body()).await;

        let current_status = status_payload
            .get("current_job")
            .and_then(|current| current.get("status"))
            .and_then(Value::as_str);
        let last_status = status_payload
            .get("last_completed_job")
            .and_then(|current| current.get("status"))
            .and_then(Value::as_str);

        if matches!(current_status, Some("running" | "queued")) {
            tokio::time::sleep(Duration::from_millis(200)).await;
            continue;
        }
        if let Some("succeeded") = last_status {
            return;
        }
        if let Some("failed") = last_status {
            panic!("{failure_context}: {status_payload}");
        }

        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    panic!("{timeout_message}");
}

#[tokio::test]
async fn health_returns_ok_and_root() {
    let temp = tempdir().expect("create temp dir");
    let root = temp.path().canonicalize().expect("canonicalize root");
    let app = build_app(root.clone());

    let response = app
        .oneshot(get_request("/health"))
        .await
        .expect("send request");

    assert_eq!(response.status(), StatusCode::OK);
    let payload = body_json(response.into_body()).await;
    assert_eq!(payload["status"], "ok");
    assert!(payload.get("root_dir").is_none());
    assert_eq!(payload["indexed_search_enabled"], false);
    assert_eq!(payload["hybrid_search_enabled"], true);
}

#[tokio::test]
async fn health_supports_cors_preflight() {
    let temp = tempdir().expect("create temp dir");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let preflight = app
        .clone()
        .oneshot(options_request("/health", "http://127.0.0.1:3000"))
        .await
        .expect("send OPTIONS request");

    assert!(preflight.status().is_success());
    let preflight_headers = preflight.headers();
    let access_control_allow_origin = preflight_headers
        .get("access-control-allow-origin")
        .unwrap()
        .to_str()
        .unwrap();
    assert_eq!(access_control_allow_origin, "http://127.0.0.1:3000");
    assert!(
        preflight_headers
            .get("access-control-allow-methods")
            .unwrap()
            .to_str()
            .unwrap()
            .contains("GET")
    );
    assert!(
        preflight_headers
            .get("access-control-allow-headers")
            .unwrap()
            .to_str()
            .unwrap()
            .to_lowercase()
            .contains("content-type")
    );

    let health_response = app
        .clone()
        .oneshot(get_request("/health"))
        .await
        .expect("send health request");
    assert_eq!(health_response.status(), StatusCode::OK);
}

#[tokio::test]
async fn api_cors_rejects_unknown_origin_preflight() {
    let temp = tempdir().expect("create temp dir");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let preflight = app
        .oneshot(options_request("/api/search", "https://evil.example"))
        .await
        .expect("send OPTIONS request");

    assert_eq!(preflight.status(), StatusCode::OK);
    assert!(
        preflight
            .headers()
            .get("access-control-allow-origin")
            .is_none()
    );
}

#[tokio::test]
async fn api_requires_authentication_and_health_stays_public() {
    let temp = tempdir().expect("create temp dir");
    fs::write(temp.path().join("notes.txt"), "Hello").expect("write text file");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let unauthenticated_file = app
        .clone()
        .oneshot(unauthenticated_get_request("/api/file?path=notes.txt"))
        .await
        .expect("send unauthenticated file request");
    assert_eq!(unauthenticated_file.status(), StatusCode::UNAUTHORIZED);

    let unauthenticated_index = app
        .clone()
        .oneshot(unauthenticated_post_request("/api/index", json!({})))
        .await
        .expect("send unauthenticated index request");
    assert_eq!(unauthenticated_index.status(), StatusCode::UNAUTHORIZED);

    let unauthenticated_health = app
        .oneshot(unauthenticated_get_request("/health"))
        .await
        .expect("send unauthenticated health request");
    assert_eq!(unauthenticated_health.status(), StatusCode::OK);
}

#[tokio::test]
async fn read_key_cannot_access_admin_endpoints() {
    let temp = tempdir().expect("create temp dir");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let forbidden = app
        .clone()
        .oneshot(post_request_with_key(
            "/api/index",
            json!({}),
            TEST_READ_API_KEY,
        ))
        .await
        .expect("send read-key admin request");
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let admin = app
        .oneshot(post_request("/api/index", json!({})))
        .await
        .expect("send admin-key admin request");
    assert_eq!(admin.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn tree_returns_directory_first_sorted() {
    let temp = tempdir().expect("create temp dir");
    let root = temp.path();
    fs::create_dir_all(root.join("b_dir")).expect("create b_dir");
    fs::create_dir_all(root.join("a_dir")).expect("create a_dir");
    fs::write(root.join("z_file.txt"), "z").expect("write z file");
    fs::write(root.join("a_file.txt"), "a").expect("write a file");

    let app = build_app(root.canonicalize().expect("canonicalize root"));
    let response = app
        .oneshot(get_request("/api/tree"))
        .await
        .expect("send request");

    assert_eq!(response.status(), StatusCode::OK);
    let payload = body_json(response.into_body()).await;
    let entries = payload["entries"].as_array().expect("entries array");
    let names_and_kinds: Vec<(String, String)> = entries
        .iter()
        .map(|entry| {
            (
                entry["name"].as_str().expect("entry name").to_string(),
                entry["kind"].as_str().expect("entry kind").to_string(),
            )
        })
        .collect();

    assert_eq!(
        names_and_kinds,
        vec![
            ("a_dir".to_string(), "directory".to_string()),
            ("b_dir".to_string(), "directory".to_string()),
            ("a_file.txt".to_string(), "file".to_string()),
            ("z_file.txt".to_string(), "file".to_string()),
        ]
    );
}

#[tokio::test]
async fn tree_rejects_parent_traversal() {
    let temp = tempdir().expect("create temp dir");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let response = app
        .oneshot(get_request("/api/tree?path=.."))
        .await
        .expect("send request");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let payload = body_json(response.into_body()).await;
    assert_eq!(
        payload["error"],
        "path must be relative and cannot contain parent traversal"
    );
}

#[tokio::test]
async fn tree_rejects_url_encoded_parent_traversal() {
    let temp = tempdir().expect("create temp dir");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let response = app
        .oneshot(get_request("/api/tree?path=%2e%2e%2fsecret"))
        .await
        .expect("send request");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let payload = body_json(response.into_body()).await;
    assert_eq!(
        payload["error"],
        "path must be relative and cannot contain parent traversal"
    );
}

#[tokio::test]
async fn file_returns_content_for_valid_text_file() {
    let temp = tempdir().expect("create temp dir");
    fs::write(temp.path().join("notes.txt"), "Hello\nWorld").expect("write text file");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let response = app
        .oneshot(get_request("/api/file?path=notes.txt"))
        .await
        .expect("send request");

    assert_eq!(response.status(), StatusCode::OK);
    let payload = body_json(response.into_body()).await;
    assert_eq!(payload["path"], "notes.txt");
    assert_eq!(payload["content"], "Hello\nWorld");
}

#[tokio::test]
async fn file_rejects_directory_and_missing_path() {
    let temp = tempdir().expect("create temp dir");
    fs::create_dir_all(temp.path().join("folder")).expect("create folder");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let dir_response = app
        .clone()
        .oneshot(get_request("/api/file?path=folder"))
        .await
        .expect("send directory request");
    assert_eq!(dir_response.status(), StatusCode::BAD_REQUEST);

    let missing_response = app
        .oneshot(get_request("/api/file?path=missing.txt"))
        .await
        .expect("send missing request");
    assert_eq!(missing_response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn file_rejects_absolute_and_url_encoded_parent_paths() {
    let temp = tempdir().expect("create temp dir");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let absolute_response = app
        .clone()
        .oneshot(get_request("/api/file?path=/etc/passwd"))
        .await
        .expect("send absolute path request");
    assert_eq!(absolute_response.status(), StatusCode::BAD_REQUEST);

    let encoded_parent_response = app
        .oneshot(get_request("/api/file?path=%2e%2e%2fsecret.txt"))
        .await
        .expect("send encoded traversal request");
    assert_eq!(encoded_parent_response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn indexed_search_requires_database_configuration() {
    let temp = tempdir().expect("create temp dir");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let response = app
        .clone()
        .oneshot(get_request("/api/search?query=alpha&limit=2"))
        .await
        .expect("send search request");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let payload = body_json(response.into_body()).await;
    assert_eq!(
        payload["error"],
        "DATABASE_URL is required for indexed search and indexing endpoints"
    );

    let hybrid_response = app
        .clone()
        .oneshot(get_request("/api/search/hybrid?query=alpha&limit=2"))
        .await
        .expect("send hybrid search request");
    assert_eq!(hybrid_response.status(), StatusCode::SERVICE_UNAVAILABLE);

    let index_start = app
        .clone()
        .oneshot(post_request("/api/index", json!({})))
        .await
        .expect("send index start request");
    assert_eq!(index_start.status(), StatusCode::SERVICE_UNAVAILABLE);

    let index_status = app
        .clone()
        .oneshot(get_request("/api/index/status"))
        .await
        .expect("send index status request");
    assert_eq!(index_status.status(), StatusCode::SERVICE_UNAVAILABLE);

    let profile_create = app
        .clone()
        .oneshot(post_request(
            "/api/profiles",
            json!({
                "display_name": "Ada",
                "email": "ada@example.com",
                "bio": "Test profile"
            }),
        ))
        .await
        .expect("send profile create request");
    assert_eq!(profile_create.status(), StatusCode::SERVICE_UNAVAILABLE);

    let profile_list = app
        .clone()
        .oneshot(get_request("/api/profiles"))
        .await
        .expect("send profile list request");
    assert_eq!(profile_list.status(), StatusCode::SERVICE_UNAVAILABLE);

    let profile_update = app
        .clone()
        .oneshot(put_request(
            "/api/profiles/1",
            json!({"display_name": "Ada"}),
        ))
        .await
        .expect("send profile update request");
    assert_eq!(profile_update.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
#[serial]
async fn search_rejects_unsafe_filter_paths() {
    let Some(test_database_url) = std::env::var("TEST_DATABASE_URL").ok() else {
        return;
    };

    let temp = tempdir().expect("create temp dir");
    fs::write(temp.path().join("alpha.rs"), "fn alpha() {}").expect("write file");
    let root = temp.path().canonicalize().expect("canonicalize root");

    configure_mock_indexing_env(&test_database_url);

    let indexing = load_indexing_from_env(Arc::new(root.clone()))
        .await
        .expect("load indexing from env")
        .expect("indexing service should be configured");

    let pool = PgPool::connect(&test_database_url)
        .await
        .expect("connect test database");
    sqlx::query("TRUNCATE TABLE semantic_blocks, indexed_files, index_jobs RESTART IDENTITY")
        .execute(&pool)
        .await
        .expect("truncate index tables");

    let app = build_app_with_indexing(root, Some(indexing));

    let absolute_filter = app
        .clone()
        .oneshot(get_request("/api/search?query=alpha&path=/etc"))
        .await
        .expect("send absolute filter request");
    assert_eq!(absolute_filter.status(), StatusCode::BAD_REQUEST);

    let traversal_filter = app
        .oneshot(get_request("/api/search?query=alpha&path=src/../secret"))
        .await
        .expect("send traversal filter request");
    assert_eq!(traversal_filter.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn hybrid_search_can_be_disabled_via_feature_toggle() {
    let temp = tempdir().expect("create temp dir");
    let app = build_app_with_indexing_and_hybrid_toggle(
        temp.path().canonicalize().expect("canonicalize root"),
        None,
        false,
    );

    let health = app
        .clone()
        .oneshot(get_request("/health"))
        .await
        .expect("send health request");
    assert_eq!(health.status(), StatusCode::OK);
    let health_payload = body_json(health.into_body()).await;
    assert_eq!(health_payload["hybrid_search_enabled"], false);

    let hybrid = app
        .oneshot(get_request("/api/search/hybrid?query=alpha&limit=2"))
        .await
        .expect("send hybrid search request");
    assert_eq!(hybrid.status(), StatusCode::NOT_FOUND);
    let hybrid_payload = body_json(hybrid.into_body()).await;
    assert_eq!(hybrid_payload["error"], "hybrid search is disabled");
}

#[tokio::test]
async fn ask_rejects_empty_question_and_empty_paths() {
    let temp = tempdir().expect("create temp dir");
    fs::write(temp.path().join("context.txt"), "line").expect("write context file");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let empty_question = app
        .clone()
        .oneshot(post_request(
            "/api/ask",
            json!({"question": "   ", "paths": ["context.txt"]}),
        ))
        .await
        .expect("send empty question request");
    assert_eq!(empty_question.status(), StatusCode::BAD_REQUEST);

    let empty_paths = app
        .oneshot(post_request(
            "/api/ask",
            json!({"question": "What is this?", "paths": []}),
        ))
        .await
        .expect("send empty paths request");
    assert_eq!(empty_paths.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ask_rejects_more_than_eight_paths() {
    let temp = tempdir().expect("create temp dir");
    let mut too_many_paths = Vec::new();
    for index in 0..10 {
        let path = format!("file_{index}.txt");
        let content = (1..=40)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(temp.path().join(&path), content).expect("write context file");
        too_many_paths.push(path);
    }

    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));
    let response = app
        .oneshot(post_request(
            "/api/ask",
            json!({"question": "Summarize the files", "paths": too_many_paths}),
        ))
        .await
        .expect("send ask request");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ask_truncates_preview_lines_for_valid_payload() {
    let temp = tempdir().expect("create temp dir");
    let mut paths = Vec::new();
    for index in 0..8 {
        let path = format!("file_{index}.txt");
        let content = (1..=40)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(temp.path().join(&path), content).expect("write context file");
        paths.push(path);
    }

    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));
    let response = app
        .oneshot(post_request(
            "/api/ask",
            json!({"question": "Summarize the files", "paths": paths}),
        ))
        .await
        .expect("send ask request");

    assert_eq!(response.status(), StatusCode::OK);
    let payload = body_json(response.into_body()).await;
    assert!(
        payload["guidance"]
            .as_str()
            .expect("guidance text")
            .contains("Summarize the files")
    );

    let context = payload["context"].as_array().expect("context array");
    assert_eq!(context.len(), 8);
    for entry in context {
        let preview = entry["preview"].as_str().expect("preview text");
        assert!(preview.lines().count() <= 30);
    }
}

#[tokio::test]
async fn api_rejects_oversized_or_overlong_requests() {
    let temp = tempdir().expect("create temp dir");
    fs::write(temp.path().join("context.txt"), "line").expect("write context file");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let oversized_body = json!({
        "question": "q",
        "paths": ["context.txt"],
        "padding": "x".repeat(20_000)
    });
    let oversized = app
        .clone()
        .oneshot(post_request("/api/ask", oversized_body))
        .await
        .expect("send oversized ask request");
    assert_eq!(oversized.status(), StatusCode::PAYLOAD_TOO_LARGE);

    let long_query = "q".repeat(2_049);
    let query_response = app
        .clone()
        .oneshot(get_request(&format!("/api/search?query={long_query}")))
        .await
        .expect("send long query request");
    assert_eq!(query_response.status(), StatusCode::BAD_REQUEST);

    let long_path = "a".repeat(1_025);
    let path_response = app
        .oneshot(get_request(&format!("/api/file?path={long_path}")))
        .await
        .expect("send long path request");
    assert_eq!(path_response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn read_endpoints_are_rate_limited() {
    let temp = tempdir().expect("create temp dir");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    for request_count in 0..61 {
        let response = app
            .clone()
            .oneshot(get_request("/api/tree"))
            .await
            .expect("send tree request");
        if request_count < 60 {
            assert_eq!(response.status(), StatusCode::OK);
        } else {
            assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        }
    }
}

#[tokio::test]
async fn create_profile_rejects_invalid_payload() {
    let temp = tempdir().expect("create temp dir");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let response = app
        .oneshot(post_request(
            "/api/profiles",
            json!({
                "display_name": " ",
                "email": "not-an-email",
                "bio": "bio"
            }),
        ))
        .await
        .expect("send profile request");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let payload = body_json(response.into_body()).await;
    assert_eq!(payload["error"], "display_name cannot be empty");
}

#[tokio::test]
#[serial]
async fn list_profiles_returns_created_profiles() {
    let Some(test_database_url) = std::env::var("TEST_DATABASE_URL").ok() else {
        return;
    };

    let temp = tempdir().expect("create temp dir");
    let root = temp.path().canonicalize().expect("canonicalize root");

    configure_mock_indexing_env(&test_database_url);

    let indexing = load_indexing_from_env(Arc::new(root.clone()))
        .await
        .expect("load indexing from env")
        .expect("indexing service should be configured");

    let pool = PgPool::connect(&test_database_url)
        .await
        .expect("connect test database");
    sqlx::query(
        "TRUNCATE TABLE semantic_blocks, indexed_files, index_jobs, user_profiles RESTART IDENTITY",
    )
    .execute(&pool)
    .await
    .expect("truncate profile and index tables");

    let app = build_app_with_indexing(root, Some(indexing));

    app.clone()
        .oneshot(post_request(
            "/api/profiles",
            json!({
                "display_name": "Ada Lovelace",
                "email": "ada@example.com",
                "bio": "Pioneer"
            }),
        ))
        .await
        .expect("send first profile request");

    app.clone()
        .oneshot(post_request(
            "/api/profiles",
            json!({
                "display_name": "Grace Hopper",
                "email": "grace@example.com",
                "bio": "Compiler"
            }),
        ))
        .await
        .expect("send second profile request");

    let response = app
        .oneshot(get_request("/api/profiles"))
        .await
        .expect("send profile list request");
    assert_eq!(response.status(), StatusCode::OK);

    let payload = body_json(response.into_body()).await;
    let profiles = payload.as_array().expect("profiles array");
    assert_eq!(profiles.len(), 2);
    assert_eq!(profiles[0]["display_name"], "Grace Hopper");
    assert_eq!(profiles[1]["display_name"], "Ada Lovelace");
}

#[tokio::test]
#[serial]
async fn update_profile_applies_edits_and_rejects_nonexistent_profile() {
    let Some(test_database_url) = std::env::var("TEST_DATABASE_URL").ok() else {
        return;
    };

    let temp = tempdir().expect("create temp dir");
    let root = temp.path().canonicalize().expect("canonicalize root");

    configure_mock_indexing_env(&test_database_url);

    let indexing = load_indexing_from_env(Arc::new(root.clone()))
        .await
        .expect("load indexing from env")
        .expect("indexing service should be configured");

    let pool = PgPool::connect(&test_database_url)
        .await
        .expect("connect test database");
    sqlx::query(
        "TRUNCATE TABLE semantic_blocks, indexed_files, index_jobs, user_profiles RESTART IDENTITY",
    )
    .execute(&pool)
    .await
    .expect("truncate profile and index tables");

    let app = build_app_with_indexing(root, Some(indexing));

    let created = app
        .clone()
        .oneshot(post_request(
            "/api/profiles",
            json!({
                "display_name": "Ada Lovelace",
                "email": "ada@example.com",
                "bio": "Pioneer"
            }),
        ))
        .await
        .expect("send create profile request");
    let created_payload = body_json(created.into_body()).await;
    let id = created_payload["id"].as_i64().expect("profile id");

    let updated = app
        .clone()
        .oneshot(put_request(
            &format!("/api/profiles/{id}"),
            json!({
                "display_name": "Ada L.",
                "email": "ada.lovelace@example.com",
                "bio": "Analytical engine"
            }),
        ))
        .await
        .expect("send profile update request");
    assert_eq!(updated.status(), StatusCode::OK);
    let updated_payload = body_json(updated.into_body()).await;
    assert_eq!(updated_payload["display_name"], "Ada L.");
    assert_eq!(updated_payload["email"], "ada.lovelace@example.com");
    assert_eq!(updated_payload["bio"], "Analytical engine");

    let missing = app
        .oneshot(put_request(
            "/api/profiles/9999",
            json!({"display_name": "Missing"}),
        ))
        .await
        .expect("send missing profile update request");
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
#[serial]
async fn indexed_search_and_hybrid_work_with_database() {
    let Some(test_database_url) = std::env::var("TEST_DATABASE_URL").ok() else {
        return;
    };

    let temp = tempdir().expect("create temp dir");
    fs::write(temp.path().join("alpha.rs"), "fn alpha() {}\nfn beta() {}").expect("write file");
    let root = temp.path().canonicalize().expect("canonicalize root");

    configure_mock_indexing_env(&test_database_url);

    let indexing = load_indexing_from_env(Arc::new(root.clone()))
        .await
        .expect("load indexing from env")
        .expect("indexing service should be configured");

    let pool = PgPool::connect(&test_database_url)
        .await
        .expect("connect test database");
    sqlx::query("TRUNCATE TABLE semantic_blocks, indexed_files, index_jobs RESTART IDENTITY")
        .execute(&pool)
        .await
        .expect("truncate index tables");

    let app = build_app_with_indexing(root, Some(indexing));

    let pre_index = app
        .clone()
        .oneshot(get_request("/api/search?query=alpha"))
        .await
        .expect("send pre-index search request");
    assert_eq!(pre_index.status(), StatusCode::CONFLICT);

    let start = app
        .clone()
        .oneshot(post_request("/api/index", json!({})))
        .await
        .expect("send index start request");
    assert_eq!(start.status(), StatusCode::ACCEPTED);

    wait_for_indexing_completion(
        &app,
        "indexing job failed",
        "indexing did not complete within timeout",
    )
    .await;

    let keyword = app
        .clone()
        .oneshot(get_request("/api/search?query=alpha"))
        .await
        .expect("send indexed keyword search request");
    let keyword_status = keyword.status();
    let keyword_payload = body_json(keyword.into_body()).await;
    assert_eq!(
        keyword_status,
        StatusCode::OK,
        "keyword search failed with payload: {keyword_payload}"
    );
    let keyword_matches = keyword_payload["matches"]
        .as_array()
        .expect("matches array");
    assert!(!keyword_matches.is_empty());

    let hybrid = app
        .oneshot(get_request("/api/search/hybrid?query=alpha"))
        .await
        .expect("send indexed hybrid search request");
    assert_eq!(hybrid.status(), StatusCode::OK);
    let hybrid_payload = body_json(hybrid.into_body()).await;
    let hybrid_matches = hybrid_payload["matches"]
        .as_array()
        .expect("hybrid matches array");
    assert!(!hybrid_matches.is_empty());
}

#[tokio::test]
#[serial]
async fn indexing_skips_sensitive_files_by_default_and_allows_override() {
    let Some(test_database_url) = std::env::var("TEST_DATABASE_URL").ok() else {
        return;
    };

    let temp = tempdir().expect("create temp dir");
    fs::write(temp.path().join(".env"), "APP_SECRET=very-secret").expect("write .env");
    fs::write(temp.path().join("private.pem"), "pem-secret").expect("write pem");
    fs::write(temp.path().join("visible.rs"), "fn visible() {}").expect("write visible file");
    let root = temp.path().canonicalize().expect("canonicalize root");

    configure_mock_indexing_env(&test_database_url);
    set_test_env_var("EXPLORER_INDEX_INCLUDE_SENSITIVE_FILES", "false");

    let indexing = load_indexing_from_env(Arc::new(root.clone()))
        .await
        .expect("load indexing from env")
        .expect("indexing service should be configured");

    let pool = PgPool::connect(&test_database_url)
        .await
        .expect("connect test database");
    sqlx::query("TRUNCATE TABLE semantic_blocks, indexed_files, index_jobs RESTART IDENTITY")
        .execute(&pool)
        .await
        .expect("truncate index tables");

    let app = build_app_with_indexing(root, Some(indexing));

    let start = app
        .clone()
        .oneshot(post_request("/api/index", json!({})))
        .await
        .expect("send index start request");
    assert_eq!(start.status(), StatusCode::ACCEPTED);

    wait_for_indexing_completion(
        &app,
        "indexing job failed",
        "indexing did not complete within timeout",
    )
    .await;

    let env_indexed: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM indexed_files WHERE path = '.env')")
            .fetch_one(&pool)
            .await
            .expect("query .env index presence");
    let pem_indexed: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM indexed_files WHERE path = 'private.pem')")
            .fetch_one(&pool)
            .await
            .expect("query .pem index presence");
    assert!(!env_indexed);
    assert!(!pem_indexed);

    set_test_env_var("EXPLORER_INDEX_INCLUDE_SENSITIVE_FILES", "true");

    let start_override = app
        .clone()
        .oneshot(post_request("/api/index", json!({})))
        .await
        .expect("send override index start request");
    assert_eq!(start_override.status(), StatusCode::ACCEPTED);

    wait_for_indexing_completion(
        &app,
        "override indexing job failed",
        "override indexing did not complete within timeout",
    )
    .await;

    let env_indexed_after_override: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM indexed_files WHERE path = '.env')")
            .fetch_one(&pool)
            .await
            .expect("query .env index presence after override");
    let pem_indexed_after_override: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM indexed_files WHERE path = 'private.pem')")
            .fetch_one(&pool)
            .await
            .expect("query .pem index presence after override");
    assert!(env_indexed_after_override);
    assert!(pem_indexed_after_override);
}

#[cfg(unix)]
#[tokio::test]
#[serial]
async fn indexing_skips_symlinked_files_that_escape_root() {
    use std::os::unix::fs::symlink;

    let Some(test_database_url) = std::env::var("TEST_DATABASE_URL").ok() else {
        return;
    };

    let temp = tempdir().expect("create temp dir");
    let outside = tempdir().expect("create outside dir");
    fs::write(temp.path().join("visible.rs"), "fn visible() {}").expect("write visible file");
    fs::write(outside.path().join("secret.txt"), "outside secret").expect("write outside file");
    symlink(
        outside.path().join("secret.txt"),
        temp.path().join("linked-secret.txt"),
    )
    .expect("create symlink");

    let root = temp.path().canonicalize().expect("canonicalize root");

    configure_mock_indexing_env(&test_database_url);

    let indexing = load_indexing_from_env(Arc::new(root.clone()))
        .await
        .expect("load indexing from env")
        .expect("indexing service should be configured");

    let pool = PgPool::connect(&test_database_url)
        .await
        .expect("connect test database");
    sqlx::query("TRUNCATE TABLE semantic_blocks, indexed_files, index_jobs RESTART IDENTITY")
        .execute(&pool)
        .await
        .expect("truncate index tables");

    let app = build_app_with_indexing(root, Some(indexing));

    let start = app
        .clone()
        .oneshot(post_request("/api/index", json!({})))
        .await
        .expect("send index start request");
    assert_eq!(start.status(), StatusCode::ACCEPTED);

    wait_for_indexing_completion(
        &app,
        "symlink indexing job failed",
        "symlink indexing did not complete within timeout",
    )
    .await;

    let symlink_indexed: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM indexed_files WHERE path = 'linked-secret.txt')",
    )
    .fetch_one(&pool)
    .await
    .expect("query symlink index presence");
    let visible_indexed: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM indexed_files WHERE path = 'visible.rs')")
            .fetch_one(&pool)
            .await
            .expect("query visible file index presence");

    assert!(!symlink_indexed);
    assert!(visible_indexed);
}

#[tokio::test]
#[serial]
async fn create_profile_persists_and_rejects_duplicate_email() {
    let Some(test_database_url) = std::env::var("TEST_DATABASE_URL").ok() else {
        return;
    };

    let temp = tempdir().expect("create temp dir");
    let root = temp.path().canonicalize().expect("canonicalize root");

    configure_mock_indexing_env(&test_database_url);

    let indexing = load_indexing_from_env(Arc::new(root.clone()))
        .await
        .expect("load indexing from env")
        .expect("indexing service should be configured");

    let pool = PgPool::connect(&test_database_url)
        .await
        .expect("connect test database");
    sqlx::query(
        "TRUNCATE TABLE semantic_blocks, indexed_files, index_jobs, user_profiles RESTART IDENTITY",
    )
    .execute(&pool)
    .await
    .expect("truncate profile and index tables");

    let app = build_app_with_indexing(root, Some(indexing));

    let created = app
        .clone()
        .oneshot(post_request(
            "/api/profiles",
            json!({
                "display_name": "Ada Lovelace",
                "email": "ADA@EXAMPLE.COM",
                "bio": "Pioneer"
            }),
        ))
        .await
        .expect("send create profile request");
    assert_eq!(created.status(), StatusCode::CREATED);
    let created_payload = body_json(created.into_body()).await;
    assert_eq!(created_payload["display_name"], "Ada Lovelace");
    assert_eq!(created_payload["email"], "ada@example.com");
    assert_eq!(created_payload["bio"], "Pioneer");
    assert!(
        created_payload["id"]
            .as_i64()
            .expect("profile id should be an integer")
            >= 1
    );
    assert!(created_payload["created_at"].as_str().is_some());

    let duplicate = app
        .oneshot(post_request(
            "/api/profiles",
            json!({
                "display_name": "Another Ada",
                "email": "ada@example.com",
                "bio": ""
            }),
        ))
        .await
        .expect("send duplicate profile request");
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    let duplicate_payload = body_json(duplicate.into_body()).await;
    assert_eq!(
        duplicate_payload["error"],
        "a profile with this email already exists"
    );
}
