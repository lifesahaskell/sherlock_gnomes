#!/usr/bin/env bash
set -euo pipefail

BACKEND_BASE_URL="${BACKEND_BASE_URL:-http://127.0.0.1:8787}"
FRONTEND_BASE_URL="${FRONTEND_BASE_URL:-http://127.0.0.1:3000}"
WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-180}"
INDEX_TIMEOUT_SECONDS="${INDEX_TIMEOUT_SECONDS:-420}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-3}"

log_step() {
  printf '\n[integration] %s\n' "$*"
}

fail() {
  printf '[integration] FAIL: %s\n' "$*" >&2
  exit 1
}

require_commands() {
  local missing=0
  for command in "$@"; do
    if ! command -v "$command" >/dev/null 2>&1; then
      printf '[integration] Missing required command: %s\n' "$command" >&2
      missing=1
    fi
  done
  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
}

backend_url() {
  printf '%s%s' "$BACKEND_BASE_URL" "$1"
}

frontend_url() {
  printf '%s%s' "$FRONTEND_BASE_URL" "$1"
}

wait_for_http_ok() {
  local url="$1"
  local label="$2"
  local start
  start="$(date +%s)"

  until curl -fsS --connect-timeout 2 --max-time 5 "$url" >/dev/null 2>&1; do
    if (( $(date +%s) - start >= WAIT_TIMEOUT_SECONDS )); then
      fail "$label did not become healthy within ${WAIT_TIMEOUT_SECONDS}s (${url})"
    fi
    sleep 2
  done
}

http_get_json() {
  curl -fsS --connect-timeout 2 --max-time 20 "$1"
}

http_post_json() {
  local url="$1"
  local payload="$2"
  curl -fsS --connect-timeout 2 --max-time 20 -X POST "$url" -H 'content-type: application/json' --data "$payload"
}

pretty_print_json() {
  local json="$1"
  if ! JSON_INPUT="$json" python3 - <<'PY' >&2
import json
import os

payload = os.environ.get("JSON_INPUT", "")
try:
    parsed = json.loads(payload)
except Exception:
    print(payload)
else:
    print(json.dumps(parsed, indent=2, sort_keys=True))
PY
  then
    printf '%s\n' "$json" >&2
  fi
}

json_expr_true() {
  local json="$1"
  local expression="$2"

  JSON_INPUT="$json" JSON_EXPR="$expression" python3 - <<'PY'
import json
import os
import sys

payload = os.environ["JSON_INPUT"]
expression = os.environ["JSON_EXPR"]

data = json.loads(payload)
ok = bool(eval(expression, {"__builtins__": {}}, {"data": data}))
sys.exit(0 if ok else 1)
PY
}

assert_json_expr() {
  local json="$1"
  local expression="$2"
  local message="$3"

  if ! json_expr_true "$json" "$expression"; then
    printf '[integration] Assertion failed: %s\n' "$message" >&2
    pretty_print_json "$json"
    exit 1
  fi
}

assert_contains() {
  local value="$1"
  local expected="$2"
  local message="$3"

  if [[ "$value" != *"$expected"* ]]; then
    printf '[integration] Assertion failed: %s\n' "$message" >&2
    printf '[integration] Expected substring: %s\n' "$expected" >&2
    exit 1
  fi
}
