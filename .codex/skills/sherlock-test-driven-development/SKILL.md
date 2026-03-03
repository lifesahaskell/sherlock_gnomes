---
name: sherlock-test-driven-development
description: Apply strict red-green-refactor loops for Sherlock Gnomes backend and frontend changes. Use when implementing features, fixing bugs, or refactoring where behavior should be specified by tests first in `backend/tests`, `frontend/**/*.test.ts(x)`, and related packages.
---

# Sherlock Test-Driven Development

Use this skill when correctness and regression safety are primary.

## Red-Green-Refactor loop

1. Red: add or modify a test that fails for the target behavior.
2. Green: make the smallest code change needed to pass.
3. Refactor: improve design/readability while keeping tests green.
4. Repeat in small increments.

## Backend TDD

- Prefer integration-style tests in `backend/tests/api.rs` for endpoint behavior.
- Add unit tests near indexing/chunking/embedding logic for algorithmic cases.
- Run focused backend tests after each loop.

## Frontend TDD

- Drive behavior through `frontend/components/*.test.tsx` and `frontend/lib/*.test.ts`.
- Test user-visible states: loading, success, empty, and error.
- Run focused frontend tests after each loop.

## Acceptance testing

- Validate user-facing outcomes for complete flows, not just individual units/contracts.
- Prefer scenario-based checks for critical paths (explore tree, view file, ask question, index, search).
- Run acceptance checks after integration/smoke checks and before handoff.

## Commands

```bash
cargo test --manifest-path backend/Cargo.toml
npm --prefix frontend run test
npm --prefix frontend run test -- --watch
```

## Guardrails

- Do not ship behavior changes without tests.
- Include unit, integration, smoke, and acceptance coverage for changed behavior.
- Keep each cycle small; avoid large mixed refactors.
- If a test is hard to write, simplify design until it is testable.
- When fixing bugs, include a regression test that fails before the fix.

## References

- TDD playbook with repo examples: `references/tdd-playbook.md`
