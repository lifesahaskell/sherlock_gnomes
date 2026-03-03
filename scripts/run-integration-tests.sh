#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: ./scripts/run-integration-tests.sh

Runs full-stack integration checks against a running stack.

Environment variables:
  BACKEND_BASE_URL       Backend base URL (default: http://127.0.0.1:8787)
  FRONTEND_BASE_URL      Frontend base URL (default: http://127.0.0.1:3000)
  WAIT_TIMEOUT_SECONDS   Service readiness timeout (default: 180)
  INDEX_TIMEOUT_SECONDS  Index completion timeout (default: 420)
  POLL_INTERVAL_SECONDS  Polling interval for index status (default: 3)
HELP
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

printf '[integration] Running full-stack integration test suite\n'
"$repo_root/scripts/integration/test-backend-core.sh"
"$repo_root/scripts/integration/test-index-search.sh"
"$repo_root/scripts/integration/test-frontend-smoke.sh"
printf '[integration] All integration checks passed\n'
