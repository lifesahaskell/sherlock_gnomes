#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: ./scripts/test-all.sh [--coverage]

Runs tests for the entire monorepo.

Options:
  --coverage   Generate coverage reports for backend and frontend.
  -h, --help   Show this help message.
HELP
}

mode="tests"
case "${1:-}" in
  "")
    ;;
  --coverage)
    mode="coverage"
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown option: $1" >&2
    usage
    exit 1
    ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ "$mode" == "tests" ]]; then
  cargo test --manifest-path backend/Cargo.toml
  npm run test --prefix frontend
  exit 0
fi

if ! command -v cargo-llvm-cov >/dev/null 2>&1; then
  echo "cargo-llvm-cov is required for --coverage." >&2
  echo "Install with: cargo install cargo-llvm-cov" >&2
  exit 1
fi

mkdir -p backend/target/llvm-cov
cargo llvm-cov --manifest-path backend/Cargo.toml --lcov --output-path backend/target/llvm-cov/lcov.info
npm run test:coverage --prefix frontend
