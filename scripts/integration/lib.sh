#!/usr/bin/env bash
set -euo pipefail

BACKEND_BASE_URL="${BACKEND_BASE_URL:-http://127.0.0.1:8787}"
FRONTEND_BASE_URL="${FRONTEND_BASE_URL:-http://127.0.0.1:3000}"
WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-180}"
INDEX_TIMEOUT_SECONDS="${INDEX_TIMEOUT_SECONDS:-420}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-3}"
INTEGRATION_READ_API_KEY="${INTEGRATION_READ_API_KEY:-${EXPLORER_READ_API_KEY:-}}"
INTEGRATION_ADMIN_API_KEY="${INTEGRATION_ADMIN_API_KEY:-${EXPLORER_ADMIN_API_KEY:-}}"
INTEGRATION_LOGIN_USERNAME="${INTEGRATION_LOGIN_USERNAME:-${LOGIN_USERNAME:-}}"
INTEGRATION_LOGIN_PASSWORD="${INTEGRATION_LOGIN_PASSWORD:-}"
FRONTEND_COOKIE_JAR="${FRONTEND_COOKIE_JAR:-/tmp/sherlock-frontend-cookie-jar.txt}"

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

frontend_get() {
  curl -fsS --connect-timeout 2 --max-time 20 -c "$FRONTEND_COOKIE_JAR" -b "$FRONTEND_COOKIE_JAR" "$1"
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

login_frontend_session() {
  if [[ -z "$INTEGRATION_LOGIN_USERNAME" || -z "$INTEGRATION_LOGIN_PASSWORD" ]]; then
    fail "frontend login credentials are required for integration checks"
  fi

  : > "$FRONTEND_COOKIE_JAR"

  local payload
  payload="$(INTEGRATION_LOGIN_USERNAME="$INTEGRATION_LOGIN_USERNAME" INTEGRATION_LOGIN_PASSWORD="$INTEGRATION_LOGIN_PASSWORD" python3 - <<'PY'
import json
import os

print(json.dumps({
    "username": os.environ["INTEGRATION_LOGIN_USERNAME"],
    "password": os.environ["INTEGRATION_LOGIN_PASSWORD"],
}))
PY
)"

  local response
  response="$(curl -fsS --connect-timeout 2 --max-time 20 -c "$FRONTEND_COOKIE_JAR" -b "$FRONTEND_COOKIE_JAR" -X POST "$(frontend_url '/api/auth/login')" -H 'content-type: application/json' --data "$payload")"
  assert_json_expr "$response" 'data.get("success") is True' "frontend login should succeed"
}

curl_with_api_key() {
  local api_key="$1"
  shift

  local curl_args=("$@")
  if [[ -n "$api_key" ]]; then
    curl_args+=(-H "x-api-key: ${api_key}")
  fi

  "${curl_args[@]}"
}

http_get_json() {
  local url="$1"
  curl_with_api_key "$INTEGRATION_READ_API_KEY" curl -fsS --connect-timeout 2 --max-time 20 "$url"
}

http_post_json() {
  local url="$1"
  local payload="$2"
  local api_key="${INTEGRATION_ADMIN_API_KEY:-$INTEGRATION_READ_API_KEY}"
  curl_with_api_key "$api_key" curl -fsS --connect-timeout 2 --max-time 20 -X POST "$url" -H 'content-type: application/json' --data "$payload"
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
# Keep eval constrained while allowing common assertion helpers used in scripts.
safe_globals = {"__builtins__": {}}
safe_locals = {
    "data": data,
    "any": any,
    "all": all,
    "len": len,
    "isinstance": isinstance,
    "list": list,
    "dict": dict,
    "tuple": tuple,
    "str": str,
    "int": int,
    "float": float,
    "bool": bool,
}
ok = bool(eval(expression, safe_globals, safe_locals))
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
