#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_commands curl

log_step "Waiting for frontend"
wait_for_http_ok "$(frontend_url '/')" "frontend"

log_step "Validating frontend shell response"
frontend_html="$(curl -fsS "$(frontend_url '/')")"
assert_contains "$frontend_html" "Sherlock Gnomes" "frontend root page should include product name"
assert_contains "$frontend_html" "AI Codebase Explorer" "frontend root page should include application title"

log_step "Frontend smoke checks passed"
