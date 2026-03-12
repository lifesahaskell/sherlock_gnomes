# Sherlock Gnomes: AI Codebase Explorer

Monorepo scaffold for a local codebase explorer with:

- `backend/`: Rust `axum` API for directory browsing, AI context assembly, repo indexing, and hybrid search.
- `frontend/`: Next.js app router UI for tree navigation, file viewing, indexing controls, search, "ask with selected files", and profile management.
- Postgres-backed git repository snapshots that import tracked text files, store derived language analysis, and expose the stored tree/file contents through the UI and API.

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

Stored git repository endpoints (require `DATABASE_URL`):

- `POST /api/git/repositories/import` with body `{ "path": "<relative_repo_path>" }`
- `GET /api/git/repositories`
- `GET /api/git/repositories/{id}/tree?path=<relative_dir>`
- `GET /api/git/repositories/{id}/file?path=<relative_file>`

Authentication:

- `GET /health` is public.
- All `/api/*` routes require credentials by default (`EXPLORER_AUTH_DISABLED=false`).
- Send credentials using `X-API-Key: <key>` (preferred) or `Authorization: Bearer <key>`.
- Read endpoints accept read/admin keys; admin endpoints (`POST /api/index`, `POST/PUT /api/profiles*`) require the admin key.
- Frontend profile writes are sent through same-origin proxy routes (`/api/internal/profiles*`) that attach the admin key server-side.

Common auth/abuse status codes:

- `401` missing or invalid credentials
- `403` read key provided for an admin-only endpoint
- `413` request body exceeds size limit
- `429` request rate limit exceeded

Feature toggle:

- `HYBRID_SEARCH_ENABLED=false` disables `GET /api/search/hybrid`, which then returns `404` with `"hybrid search is disabled"`.

Path traversal is blocked (`..` and absolute paths are rejected), and all reads are restricted to `EXPLORER_ROOT`.
Git repository imports are also restricted to repositories that resolve within `EXPLORER_ROOT`.

`GET /api/search` and `GET /api/search/hybrid` return `409` until at least one successful index exists.

Indexing defaults:

- Hidden files and sensitive files are excluded from indexing by default.
- Set `EXPLORER_INDEX_INCLUDE_SENSITIVE_FILES=true` only when you intentionally need to include them.

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
EXPLORER_READ_API_KEY=dev-read-key \
EXPLORER_ADMIN_API_KEY=dev-admin-key \
OPENAI_API_KEY=your_key_here \
cargo run
```

Optional env vars:

- `HOST` (default: `127.0.0.1`)
- `PORT` (default: `8787`)
- `EXPLORER_ROOT` (default: current directory)
- `EXPLORER_AUTH_DISABLED` (default: `false`; set `true` only for explicit local/dev opt-out)
- `EXPLORER_READ_API_KEY` (required when auth is enabled; grants read scope)
- `EXPLORER_ADMIN_API_KEY` (required when auth is enabled; grants admin scope)
- `EXPLORER_ALLOWED_ORIGINS` (comma-separated CORS allowlist; defaults to localhost frontend origins)
- `EXPLORER_INDEX_INCLUDE_SENSITIVE_FILES` (default: `false`; includes hidden/sensitive files when `true`)
- `DATABASE_URL` (required for `/api/index*` and `/api/search*`)
- `HYBRID_SEARCH_ENABLED` (default: `true`; set to `false` to disable `/api/search/hybrid`)
- `EMBEDDING_PROVIDER` (default: `openai`; `mock` is available for local/testing)
- `EMBEDDING_MODEL` (default: `text-embedding-3-small`)
- `OPENAI_API_KEY` (required when `EMBEDDING_PROVIDER=openai`)

### 3) Frontend (Next.js)

```bash
cd frontend
npm install
SESSION_SECRET=replace-with-at-least-32-characters \
LOGIN_USERNAME=admin \
LOGIN_PASSWORD_HASH='<bcrypt hash for your password>' \
EXPLORER_BACKEND_API_BASE=http://127.0.0.1:8787 \
EXPLORER_READ_API_KEY=dev-read-key \
EXPLORER_ADMIN_API_KEY=dev-admin-key \
npm run dev
```

Open `http://127.0.0.1:3000`.

Generate a bcrypt password hash from the `frontend/` directory with:

```bash
node -e "const bcrypt=require('bcryptjs'); console.log(bcrypt.hashSync('change-me', 10));"
```

### 4) Trigger indexing

Use the UI `Start/Reindex` button or call the API:

```bash
curl -X POST http://127.0.0.1:8787/api/index \
  -H 'x-api-key: your_admin_api_key' \
  -H 'content-type: application/json' \
  -d '{}'
```

Poll status:

```bash
curl http://127.0.0.1:8787/api/index/status \
  -H 'x-api-key: your_read_api_key'
```

### 5) Import a git repository snapshot into Postgres

Use the Explorer UI "Repository Archive" section or call the API:

```bash
curl -X POST http://127.0.0.1:8787/api/git/repositories/import \
  -H 'x-api-key: your_admin_api_key' \
  -H 'content-type: application/json' \
  -d '{"path":"."}'
```

List stored repositories:

```bash
curl http://127.0.0.1:8787/api/git/repositories \
  -H 'x-api-key: your_read_api_key'
```

Each stored repository record includes branch/head metadata, dirty-state detection, tracked-vs-stored file counts, and a language breakdown for the imported text files.

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

Required environment:

```bash
EXPLORER_READ_API_KEY=your_read_api_key \
EXPLORER_ADMIN_API_KEY=your_admin_api_key \
SESSION_SECRET=replace-with-at-least-32-characters \
LOGIN_USERNAME=your_login_username \
LOGIN_PASSWORD_HASH='<bcrypt hash for your password>' \
EXPLORER_BACKEND_API_BASE=http://backend:8787 \
OPENAI_API_KEY=your_key_here \
EMBEDDING_PROVIDER=openai \
docker compose up --build -d
```

Notes:

- Backend container reads files from a read-only bind mount of the repo at `/workspace`.
- Backend root path is controlled by `EXPLORER_ROOT` (default in compose: `/workspace`).
- Backend bind address is configurable with `HOST` (default: `127.0.0.1`; compose uses `0.0.0.0`).
- Browser clients no longer receive backend API keys; frontend reads and writes go through same-origin Next.js proxy routes.

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
