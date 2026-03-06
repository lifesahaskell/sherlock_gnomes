use sqlx::PgPool;

fn test_database_url() -> Option<String> {
    std::env::var("TEST_DATABASE_URL")
        .ok()
        .or_else(|| std::env::var("DATABASE_URL").ok())
}

#[tokio::test]
async fn migrations_create_expected_tables_and_indexes() {
    let Some(database_url) = test_database_url() else {
        return;
    };

    let pool = PgPool::connect(&database_url)
        .await
        .expect("connect migration test database");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("apply migrations");

    for table in ["index_jobs", "indexed_files", "semantic_blocks"] {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = $1)",
        )
        .bind(table)
        .fetch_one(&pool)
        .await
        .expect("query table existence");
        assert!(exists, "expected table {table} to exist after migrations");
    }

    for index in [
        "semantic_blocks_path_idx",
        "semantic_blocks_keyword_idx",
        "semantic_blocks_embedding_idx",
    ] {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname = $1)")
                .bind(index)
                .fetch_one(&pool)
                .await
                .expect("query index existence");
        assert!(exists, "expected index {index} to exist after migrations");
    }
}
