# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Sherlock Gnomes is a monorepo for a local AI codebase explorer:
- **`backend/`** — Rust/axum API (port 8787) for directory browsing, AI Q&A, indexing, and hybrid search
- **`frontend/`** — Next.js (App Router) UI (port 3000) for tree navigation, file viewing, search, and profile management

## Commands

### Backend (Rust)
```bash
cargo test --manifest-path backend/Cargo.toml          # run all backend tests
cargo test --manifest-path backend/Cargo.toml <name>   # run a single test
cargo fmt --manifest-path backend/Cargo.toml --all -- --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
```

### Frontend (Next.js / Vitest)
```bash
npm run test --prefix frontend                          # run all frontend tests
npm --prefix frontend run lint
npx --prefix frontend vitest run <file-pattern>        # run a single test file
```

### Full test suite
```bash
./scripts/test-all.sh            # runs both backend and frontend tests
./scripts/test-all.sh --coverage # also generates coverage reports
./scripts/run-integration-tests.sh  # requires running backend + frontend + postgres
```

### Running locally
Requires Postgres with pgvector (`docker run ... pgvector/pgvector:pg17`).

**Backend:**
```bash
cd backend
DATABASE_URL=postgres://sherlock:sherlock@127.0.0.1:5432/sherlock \
EXPLORER_ROOT=.. EXPLORER_READ_API_KEY=dev-read-key EXPLORER_ADMIN_API_KEY=dev-admin-key \
OPENAI_API_KEY=<key> cargo run
```

**Frontend:**
```bash
cd frontend && npm install
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8787 \
NEXT_PUBLIC_EXPLORER_READ_API_KEY=dev-read-key \
EXPLORER_BACKEND_API_BASE=http://127.0.0.1:8787 npm run dev
```

Or run the full stack: `docker compose up --build -d`

## Architecture

### Backend (`backend/src/`)
- **`main.rs`** — entry point; loads env, builds `AppState`, runs migrations, binds server
- **`lib.rs`** — axum router, middleware (auth, rate limiting, CORS, body limit), all request handlers; exports `build_app_with_indexing_and_hybrid_toggle_and_security` for tests
- **`indexing/mod.rs`** — `IndexingService`: queues/runs index jobs, stores chunks in Postgres, implements hybrid search (keyword + vector with RRF fusion), and manages `UserProfile` CRUD
- **`indexing/chunking.rs`** — tree-sitter semantic chunking for Rust/TS/JS/TSX/Markdown; falls back to sliding-window text splitting
- **`indexing/embeddings.rs`** — `EmbeddingProvider` trait with OpenAI and mock implementations

**Auth model:** Two scopes — `Read` (GET endpoints) and `Admin` (POST index, POST/PUT profiles). Keys sent via `X-API-Key` or `Authorization: Bearer`. Rate limits: 60 req/min read, 15 req/min admin.

**Path safety:** All file/tree paths are validated against `EXPLORER_ROOT`; `..` and absolute paths are rejected. Sensitive files are excluded from indexing by default.

### Frontend (`frontend/`)
- **`app/`** — Next.js App Router pages: `/` homepage, `/explorer` tree+file viewer, `/docs` API docs, `/profile` user profiles
- **`components/`** — `top-nav.tsx` (shared nav), `explorer.tsx` (tree/file/search/ask UI)
- **`lib/api.ts`** — all client-side calls to the backend; attaches `X-API-Key` from `NEXT_PUBLIC_EXPLORER_READ_API_KEY` automatically
- **`lib/profile-admin.ts`** — profile write helpers that call the internal Next.js proxy (not the backend directly)
- **`app/api/internal/profiles/`** — server-side Next.js route that attaches `EXPLORER_ADMIN_API_KEY` before proxying profile writes to the backend; prevents the admin key from being exposed to the browser

### Key design decisions
- Frontend profile writes go through `/api/internal/profiles*` (Next.js server route) → backend, so the admin key stays server-side only
- `EMBEDDING_PROVIDER=mock` skips OpenAI for local testing/CI
- `EXPLORER_AUTH_DISABLED=true` bypasses auth (dev only)
- `HYBRID_SEARCH_ENABLED=false` disables `/api/search/hybrid`
- Backend integration tests use `serial_test` crate to serialize DB-touching tests
