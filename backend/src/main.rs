use std::{env, net::SocketAddr, sync::Arc};

use codebase_explorer_backend::{
    build_app_with_indexing_and_hybrid_toggle_and_security, load_api_security_config,
    load_hybrid_search_enabled_from_env, load_indexing_from_env, load_root_dir_from_env,
    validate_runtime_security_config,
};

#[tokio::main]
async fn main() {
    let root_dir =
        load_root_dir_from_env().expect("failed to resolve EXPLORER_ROOT or current directory");
    let indexing = load_indexing_from_env(Arc::new(root_dir.clone()))
        .await
        .expect("failed to initialize indexing subsystem");
    let hybrid_search_enabled = load_hybrid_search_enabled_from_env();
    let security = load_api_security_config();
    validate_runtime_security_config(&security)
        .expect("invalid security configuration for runtime startup");
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
    if indexing.is_none() {
        println!("Indexed search disabled: DATABASE_URL is not configured");
    }
    if !hybrid_search_enabled {
        println!("Hybrid search disabled: HYBRID_SEARCH_ENABLED is false");
    }
    if security.auth_enforced() {
        println!("API authentication enabled for all /api/* routes");
    } else {
        println!("API authentication disabled: EXPLORER_AUTH_DISABLED=true");
    }

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind TCP listener");
    axum::serve(
        listener,
        build_app_with_indexing_and_hybrid_toggle_and_security(
            root_dir,
            indexing,
            hybrid_search_enabled,
            security,
        ),
    )
    .await
    .expect("server failed");
}
