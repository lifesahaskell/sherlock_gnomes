use std::{env, net::SocketAddr};

use codebase_explorer_backend::{build_app, load_root_dir_from_env};

#[tokio::main]
async fn main() {
    let root_dir =
        load_root_dir_from_env().expect("failed to resolve EXPLORER_ROOT or current directory");
    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8787);
    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .expect("failed to parse HOST and PORT into socket address");

    println!("Codebase explorer backend listening on http://{}", addr);
    println!("Exploring root directory: {}", root_dir.display());

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind TCP listener");
    axum::serve(listener, build_app(root_dir))
        .await
        .expect("server failed");
}
