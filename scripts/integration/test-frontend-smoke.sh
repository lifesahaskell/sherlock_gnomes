#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_commands curl
require_commands python3

log_step "Waiting for frontend"
wait_for_http_ok "$(frontend_url '/')" "frontend"

log_step "Validating public login route response"
login_html="$(curl -fsS "$(frontend_url '/login')")"
assert_contains "$login_html" "Log In" "login route should include login heading"
assert_contains "$login_html" "Enter your credentials" "login route should include login instructions"

log_step "Authenticating frontend session"
login_frontend_session

log_step "Validating authenticated frontend shell response"
frontend_html="$(frontend_get "$(frontend_url '/')")"
assert_contains "$frontend_html" "Sherlock Gnomes" "frontend root page should include product name"
assert_contains "$frontend_html" "Go to Explorer" "frontend root page should include explorer call to action"
assert_contains "$frontend_html" "Docs" "frontend root page should include docs navigation"
assert_contains "$frontend_html" "Profile" "frontend root page should include profile navigation"

log_step "Validating explorer route response"
explorer_html="$(frontend_get "$(frontend_url '/explorer')")"
assert_contains "$explorer_html" "AI Codebase Explorer" "explorer route should include application title"
assert_contains "$explorer_html" "Tree" "explorer route should include file tree section"

log_step "Validating authenticated frontend API proxy"
tree_json="$(frontend_get "$(frontend_url '/api/tree?path=')")"
assert_json_expr "$tree_json" 'isinstance(data.get("entries"), list) and any(entry.get("path") == "README.md" for entry in data.get("entries", []))' "frontend tree proxy should expose README.md after login"

log_step "Validating docs route response"
docs_html="$(frontend_get "$(frontend_url '/docs')")"
assert_contains "$docs_html" "Docs are coming soon" "docs route should include placeholder heading"
assert_contains "$docs_html" "Open Explorer" "docs route should include explorer quick link"

log_step "Validating profile route response"
profile_html="$(frontend_get "$(frontend_url '/profile')")"
assert_contains "$profile_html" "Create Profile" "profile route should include create-profile heading"
assert_contains "$profile_html" "Profile name" "profile route should include profile form field"

log_step "Frontend smoke checks passed"
