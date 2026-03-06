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
assert_contains "$frontend_html" "Go to Explorer" "frontend root page should include explorer call to action"
assert_contains "$frontend_html" "Docs" "frontend root page should include docs navigation"
assert_contains "$frontend_html" "Profile" "frontend root page should include profile navigation"

log_step "Validating explorer route response"
explorer_html="$(curl -fsS "$(frontend_url '/explorer')")"
assert_contains "$explorer_html" "AI Codebase Explorer" "explorer route should include application title"
assert_contains "$explorer_html" "Tree" "explorer route should include file tree section"

log_step "Validating docs route response"
docs_html="$(curl -fsS "$(frontend_url '/docs')")"
assert_contains "$docs_html" "Docs are coming soon" "docs route should include placeholder heading"
assert_contains "$docs_html" "Open Explorer" "docs route should include explorer quick link"

log_step "Validating profile route response"
profile_html="$(curl -fsS "$(frontend_url '/profile')")"
assert_contains "$profile_html" "Create Profile" "profile route should include create-profile heading"
assert_contains "$profile_html" "Profile name" "profile route should include profile form field"

log_step "Frontend smoke checks passed"
