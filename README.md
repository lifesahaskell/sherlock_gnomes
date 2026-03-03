# Sherlock Gnomes: AI Codebase Explorer

Monorepo scaffold for a local codebase explorer with:

- `backend/`: Rust `axum` API for directory browsing, AI context assembly, repo indexing, and hybrid search.
- `frontend/`: Next.js app router UI for tree navigation, file viewing, indexing controls, search, and "ask with selected files".

## Project layout

```text
.
├── backend
│   ├── Cargo.toml
│   ├── migrations/
│   ├── src/lib.rs
│   ├── src/main.rs
│   └── tests/api.rs
└── frontend
    ├── app/
    ├── components/
    ├── lib/
    └── test/
```

## Backend API

The backend serves on `http://127.0.0.1:8787` by default.

Core endpoints:

- `GET /health`
- `GET /api/tree?path=<relative_dir>`
- `GET /api/file?path=<relative_file>`
- `POST /api/ask` with body:
  - `question: string`
  - `paths: string[]`

Indexed search and indexing endpoints (require `DATABASE_URL`):

- `POST /api/index` with body `{}`
- `GET /api/index/status`
- `GET /api/search?query=<text>&path=<relative_prefix>&limit=<n>`
- `GET /api/search/hybrid?query=<text>&path=<relative_prefix>&limit=<n>`

Feature toggle:

- `HYBRID_SEARCH_ENABLED=false` disables `GET /api/search/hybrid`, which then returns `404` with `"hybrid search is disabled"`.

Path traversal is blocked (`..` and absolute paths are rejected), and all reads are restricted to `EXPLORER_ROOT`.

`GET /api/search` and `GET /api/search/hybrid` return `409` until at least one successful index exists.

## Run locally

### 1) Start Postgres with pgvector

```bash
docker run --name sherlock-postgres \
  -e POSTGRES_DB=sherlock \
  -e POSTGRES_USER=sherlock \
  -e POSTGRES_PASSWORD=sherlock \
  -p 5432:5432 \
  -d pgvector/pgvector:pg17
```

### 2) Backend (Rust)

```bash
cd backend
DATABASE_URL=postgres://sherlock:sherlock@127.0.0.1:5432/sherlock \
EXPLORER_ROOT=.. \
OPENAI_API_KEY=your_key_here \
cargo run
```

Optional env vars:

- `HOST` (default: `127.0.0.1`)
- `PORT` (default: `8787`)
- `EXPLORER_ROOT` (default: current directory)
- `DATABASE_URL` (required for `/api/index*` and `/api/search*`)
- `HYBRID_SEARCH_ENABLED` (default: `true`; set to `false` to disable `/api/search/hybrid`)
- `EMBEDDING_PROVIDER` (default: `openai`; `mock` is available for local/testing)
- `EMBEDDING_MODEL` (default: `text-embedding-3-small`)
- `OPENAI_API_KEY` (required when `EMBEDDING_PROVIDER=openai`)

### 3) Frontend (Next.js)

```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8787 npm run dev
```

Open `http://127.0.0.1:3000`.

### 4) Trigger indexing

Use the UI `Start/Reindex` button or call the API:

```bash
curl -X POST http://127.0.0.1:8787/api/index \
  -H 'content-type: application/json' \
  -d '{}'
```

Poll status:

```bash
curl http://127.0.0.1:8787/api/index/status
```

## Deployment (Docker Compose)

Build and run the stack:

```bash
docker compose up --build -d
```

Stop the stack:

```bash
docker compose down
```

Services:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8787`
- Postgres+pgvector: `localhost:5432`

Optional overrides:

```bash
NEXT_PUBLIC_API_BASE=http://localhost:8787 \
OPENAI_API_KEY=your_key_here \
EMBEDDING_PROVIDER=openai \
docker compose up --build -d
```

Notes:

- Backend container reads files from a read-only bind mount of the repo at `/workspace`.
- Backend root path is controlled by `EXPLORER_ROOT` (default in compose: `/workspace`).
- Backend bind address is configurable with `HOST` (default: `127.0.0.1`; compose uses `0.0.0.0`).

## Testing

Run all tests from repo root:

```bash
./scripts/test-all.sh
```

Or run package-level commands directly:

```bash
cargo test --manifest-path backend/Cargo.toml
npm run test --prefix frontend
```

Lint checks:

```bash
cargo fmt --manifest-path backend/Cargo.toml --all -- --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
npm --prefix frontend run lint
```

Generate coverage reports for both backend and frontend:

```bash
./scripts/test-all.sh --coverage
```

Run full-stack integration checks (requires running backend, frontend, and postgres services):

```bash
./scripts/run-integration-tests.sh
```

Coverage artifact paths:

- Backend LCOV: `backend/target/llvm-cov/lcov.info`
- Frontend reports: `frontend/coverage/`

CI:

- GitHub Actions workflow at `.github/workflows/lint.yml` runs backend and frontend lint jobs on every push and pull request.
- GitHub Actions workflow at `.github/workflows/tests.yml` runs backend tests (with pgvector service), frontend tests, a Docker Compose full-stack integration suite, and a separate coverage job.
- GitHub Actions workflow at `.github/workflows/audit.yml` runs dependency audits (`cargo audit` and `npm audit`) on push/pull request and on manual dispatch.
