---
name: sherlock-rust-backend
description: Implement, refactor, and debug the Sherlock Gnomes Rust backend (Axum + SQLx + pgvector). Use when tasks touch `backend/src`, `backend/tests`, `backend/migrations`, API handlers, indexing/search logic, embedding providers, SQL queries, or Rust backend quality checks.
---

# Sherlock Rust Backend

Use this skill to ship backend changes safely with fast feedback.

## Workflow

1. Read impacted files in `backend/src`, then confirm API/test impact in `backend/tests/api.rs`.
2. For schema/query changes, inspect `backend/migrations` and keep SQLx/Postgres behavior aligned.
3. Implement minimal code changes with explicit error handling and path safety.
4. Run focused checks first, then full backend checks.

## Commands

Run from repo root unless noted.

```bash
cargo test --manifest-path backend/Cargo.toml
cargo fmt --manifest-path backend/Cargo.toml --all -- --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
```

Use project-wide tests when backend changes affect frontend contracts:

```bash
./scripts/test-all.sh
```

## Guardrails

- Keep file access constrained to `EXPLORER_ROOT`; reject absolute paths and traversal.
- Maintain compatibility for `GET /health`, `GET /api/tree`, `GET /api/file`, `POST /api/ask`.
- Preserve index/search semantics for `/api/index*`, `/api/search`, `/api/search/hybrid`.
- Add or update tests for behavior changes and regression risk.

## References

- Architecture and backend surface: `references/backend-map.md`
