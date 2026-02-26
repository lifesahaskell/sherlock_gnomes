use std::fs;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use codebase_explorer_backend::build_app;
use http_body_util::BodyExt;
use serde_json::{Value, json};
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
async fn search_is_case_insensitive_and_respects_limit() {
    let temp = tempdir().expect("create temp dir");
    fs::write(temp.path().join("first.txt"), "Alpha\nBeta\nALPHA here").expect("write first file");
    fs::write(temp.path().join("second.txt"), "alpha again\nnothing").expect("write second file");
    let app = build_app(temp.path().canonicalize().expect("canonicalize root"));

    let response = app
        .oneshot(get_request("/api/search?query=alpha&limit=2"))
        .await
        .expect("send search request");

    assert_eq!(response.status(), StatusCode::OK);
    let payload = body_json(response.into_body()).await;
    let matches = payload["matches"].as_array().expect("matches array");
    assert_eq!(matches.len(), 2);
    assert_eq!(payload["query"], "alpha");

    for item in matches {
        let line = item["line"].as_str().expect("line text").to_lowercase();
        assert!(line.contains("alpha"));
    }
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
