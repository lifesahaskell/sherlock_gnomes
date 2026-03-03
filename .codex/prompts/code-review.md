# Code Review Prompt

Review changes in `sherlock_gnomes` with a bug/risk-first mindset.

## Review focus

- Correctness and behavior regressions.
- Security and path traversal protections.
- API contract drift between backend and frontend.
- Missing or weak tests.
- Operational risk in compose/runtime config.

## Output format

1. Findings by severity with file/line references.
2. Open questions/assumptions.
3. Brief summary only after findings.

## Commands (as needed)

- `git diff -- <path>`
- `cargo test --manifest-path backend/Cargo.toml`
- `npm --prefix frontend run test`
