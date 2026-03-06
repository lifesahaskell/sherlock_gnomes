#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_commands curl python3

log_step "Waiting for backend before indexing"
wait_for_http_ok "$(backend_url '/health')" "backend"

log_step "Starting indexing job"
index_start_json="$(http_post_json "$(backend_url '/api/index')" '{}')"
assert_json_expr "$index_start_json" 'isinstance(data.get("job_id"), str) and len(data.get("job_id")) > 0' "index start should return a job id"
assert_json_expr "$index_start_json" 'data.get("status") in ("queued", "running")' "index start status should be queued or running"
index_job_id="$(JSON_INPUT="$index_start_json" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["JSON_INPUT"])
print(payload.get("job_id", ""))
PY
)"
if [[ -z "$index_job_id" ]]; then
  fail "index start response did not include a job_id"
fi

log_step "Polling index status until completion"
index_deadline=$(( $(date +%s) + INDEX_TIMEOUT_SECONDS ))
status_json='{}'
while true; do
  status_json="$(http_get_json "$(backend_url '/api/index/status')")"

  if json_expr_true "$status_json" "isinstance(data.get('last_completed_job'), dict) and data.get('last_completed_job', {}).get('job_id') == '$index_job_id' and data.get('last_completed_job', {}).get('status') == 'succeeded'"; then
    break
  fi

  if json_expr_true "$status_json" "isinstance(data.get('last_completed_job'), dict) and data.get('last_completed_job', {}).get('job_id') == '$index_job_id' and data.get('last_completed_job', {}).get('status') == 'failed'"; then
    pretty_print_json "$status_json"
    fail "indexing reported failed status"
  fi

  if (( $(date +%s) >= index_deadline )); then
    pretty_print_json "$status_json"
    fail "indexing did not complete within ${INDEX_TIMEOUT_SECONDS}s"
  fi

  sleep "$POLL_INTERVAL_SECONDS"
done

assert_json_expr "$status_json" "data.get('last_completed_job', {}).get('job_id') == '$index_job_id'" "status should report completion for the requested indexing job"
assert_json_expr "$status_json" 'data.get("last_completed_job", {}).get("files_indexed", 0) >= 1' "completed index job should index at least one file"

log_step "Running keyword search assertions"
keyword_json="$(http_get_json "$(backend_url '/api/search?query=Sherlock&limit=100')")"
assert_json_expr "$keyword_json" 'isinstance(data.get("matches"), list) and len(data.get("matches")) >= 1' "keyword search should return at least one match"
assert_json_expr "$keyword_json" 'any(match.get("path") == "README.md" for match in data.get("matches", []))' "keyword search should surface README.md"

log_step "Running hybrid search assertions"
hybrid_json="$(http_get_json "$(backend_url '/api/search/hybrid?query=Sherlock&limit=5')")"
assert_json_expr "$hybrid_json" 'isinstance(data.get("matches"), list) and len(data.get("matches")) >= 1' "hybrid search should return at least one match"

log_step "Index and search integration checks passed"
