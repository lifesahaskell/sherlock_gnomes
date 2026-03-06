use std::{fs, sync::Arc, time::Duration};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use codebase_explorer_backend::{
    build_app, build_app_with_indexing, build_app_with_indexing_and_hybrid_toggle,
    load_indexing_from_env,
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use serial_test::serial;
use sqlx::PgPool;
use tempfile::tempdir;
use tower::ServiceExt;

async fn body_json(body: Body) -> Value {
    let bytes = body.collect().await.expect("collect body bytes").to_bytes();
    serde_json::from_slice(&bytes).expect("parse response JSON")
}

fn get_request(uri: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(uri)
        .body(Body::empty())
        .expect("build GET request")
}

fn post_request(uri: &str, payload: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(payload.to_string()))
        .expect("build POST request")
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
    assert_eq!(payload["root_dir"], root.to_string_lossy().to_string());
    assert_eq!(payload["indexed_search_enabled"], false);
    assert_eq!(payload["hybrid_search_enabled"], true);
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
        .oneshot(get_request("/api/index/status"))
        .await
        .expect("send index status request");
    assert_eq!(index_status.status(), StatusCode::SERVICE_UNAVAILABLE);
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

    // SAFETY: This test opts into environment mutation and is gated by TEST_DATABASE_URL.
    unsafe {
        std::env::set_var("DATABASE_URL", &test_database_url);
        std::env::set_var("EMBEDDING_PROVIDER", "mock");
    }

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
async fn ask_caps_context_to_eight_files_and_truncates_preview_lines() {
    let temp = tempdir().expect("create temp dir");
    let mut paths = Vec::new();
    for index in 0..10 {
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
#[serial]
async fn indexed_search_and_hybrid_work_with_database() {
    let Some(test_database_url) = std::env::var("TEST_DATABASE_URL").ok() else {
        return;
    };

    let temp = tempdir().expect("create temp dir");
    fs::write(temp.path().join("alpha.rs"), "fn alpha() {}\nfn beta() {}").expect("write file");
    let root = temp.path().canonicalize().expect("canonicalize root");

    // SAFETY: This test opts into environment mutation and is gated by TEST_DATABASE_URL.
    unsafe {
        std::env::set_var("DATABASE_URL", &test_database_url);
        std::env::set_var("EMBEDDING_PROVIDER", "mock");
    }

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

    let mut completed = false;
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
            completed = true;
            break;
        }
        if let Some("failed") = last_status {
            panic!("indexing job failed: {status_payload}");
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert!(completed, "indexing did not complete within timeout");

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
