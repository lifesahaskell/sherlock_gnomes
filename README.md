# Sherlock Gnomes: AI Codebase Explorer

Monorepo scaffold for a local codebase explorer with:

- `backend/`: Rust `axum` API for directory browsing, file reads, text search, and AI context assembly.
- `frontend/`: Next.js app router UI for tree navigation, file viewing, search, and "ask with selected files".

## Project layout

```text
.
├── backend
│   ├── Cargo.toml
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

- `GET /health`
- `GET /api/tree?path=<relative_dir>`
- `GET /api/file?path=<relative_file>`
- `GET /api/search?query=<text>&path=<relative_dir>&limit=<n>`
- `POST /api/ask` with body:
  - `question: string`
  - `paths: string[]`

Path traversal is blocked (`..` and absolute paths are rejected), and all reads are restricted to `EXPLORER_ROOT`.

## Run locally

### 1) Backend (Rust)

```bash
cd backend
EXPLORER_ROOT=.. cargo run
```

Optional env vars:

- `PORT` (default: `8787`)
- `EXPLORER_ROOT` (default: current directory)

### 2) Frontend (Next.js)

```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8787 npm run dev
```

Open `http://127.0.0.1:3000`.

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

Optional API base override at build time:

```bash
NEXT_PUBLIC_API_BASE=http://localhost:8787 docker compose up --build -d
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

Coverage artifact paths:

- Backend LCOV: `backend/target/llvm-cov/lcov.info`
- Frontend reports: `frontend/coverage/`

CI:

- GitHub Actions workflow at `.github/workflows/lint.yml` runs backend and frontend lint jobs on every push and pull request.
- GitHub Actions workflow at `.github/workflows/tests.yml` runs backend tests, frontend tests, and a separate coverage job on every push and pull request.
- GitHub Actions workflow at `.github/workflows/audit.yml` runs dependency audits (`cargo audit` and `npm audit`) on push/pull request and on manual dispatch.
- Coverage is report-only in CI (no percentage thresholds are enforced).

## Notes

- This scaffold intentionally keeps AI-provider integration out of the backend.
- `POST /api/ask` currently builds context previews and prompt guidance. You can pipe this to OpenAI/Anthropic/local models from the frontend or a worker service.
