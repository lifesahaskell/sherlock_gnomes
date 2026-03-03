# Ops Runbook

## Services

- `postgres`: pgvector on port `5432`.
- `backend`: Axum API on port `8787`.
- `frontend`: Next.js app on port `3000`.

## Key environment variables

- `NEXT_PUBLIC_API_BASE`: Frontend to backend base URL.
- `DATABASE_URL`: Backend Postgres DSN.
- `EXPLORER_ROOT`: Backend filesystem root.
- `EMBEDDING_PROVIDER`: `openai` or `mock`.
- `EMBEDDING_MODEL`: embedding model name.
- `OPENAI_API_KEY`: required for OpenAI provider.

## Smoke checks

```bash
curl -f http://127.0.0.1:8787/health
curl -f 'http://127.0.0.1:8787/api/tree?path='
curl -f -X POST http://127.0.0.1:8787/api/index -H 'content-type: application/json' -d '{}'
curl -f http://127.0.0.1:8787/api/index/status
```

## CI-equivalent checks

```bash
cargo fmt --manifest-path backend/Cargo.toml --all -- --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path backend/Cargo.toml
npm --prefix frontend run lint
npm --prefix frontend run test
```
