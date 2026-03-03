#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_commands curl python3

log_step "Waiting for backend health endpoint"
wait_for_http_ok "$(backend_url '/health')" "backend"

log_step "Validating backend health payload"
health_json="$(http_get_json "$(backend_url '/health')")"
assert_json_expr "$health_json" 'data.get("status") == "ok"' "health status should be ok"
assert_json_expr "$health_json" 'data.get("indexed_search_enabled") is True' "indexed search should be enabled in integration environment"

log_step "Validating tree and file endpoints"
tree_json="$(http_get_json "$(backend_url '/api/tree?path=')")"
assert_json_expr "$tree_json" 'isinstance(data.get("entries"), list) and len(data.get("entries")) > 0' "tree should contain entries"
assert_json_expr "$tree_json" 'any(entry.get("path") == "README.md" and entry.get("kind") == "file" for entry in data.get("entries", []))' "README.md should be discoverable from root tree"

file_json="$(http_get_json "$(backend_url '/api/file?path=README.md')")"
assert_json_expr "$file_json" 'data.get("path") == "README.md"' "file endpoint should return README.md path"
assert_json_expr "$file_json" '"Sherlock Gnomes" in data.get("content", "")' "README content should include project title"

log_step "Validating ask endpoint context assembly"
ask_json="$(http_post_json "$(backend_url '/api/ask')" '{"question":"What does this project do?","paths":["README.md"]}')"
assert_json_expr "$ask_json" '"What does this project do?" in data.get("guidance", "")' "guidance should include submitted question"
assert_json_expr "$ask_json" 'isinstance(data.get("context"), list) and len(data.get("context")) >= 1' "ask should return context previews"
assert_json_expr "$ask_json" 'any(entry.get("path") == "README.md" for entry in data.get("context", []))' "ask context should include README.md"

log_step "Backend core integration checks passed"
