---
name: sherlock-full-stack-change
description: Plan and implement cross-layer changes in Sherlock Gnomes that span Next.js UI, Rust backend APIs, indexing/data behavior, and end-to-end verification. Use when tasks require coordinated edits across `frontend/*`, `backend/*`, API contracts, migrations, or stack-level validation.
---

# Sherlock Full-Stack Change

Use this skill to execute multi-layer features and fixes without contract drift.

## Workflow

1. Define contract first: request/response shape, status codes, and error semantics.
2. Map impacted files in both layers before editing.
3. Implement backend contract changes and tests.
4. Implement frontend integration changes and tests.
5. Run lint/tests for both packages, then run full suite when impact is broad.

## Execution order

- Backend contract: handlers, types, indexing/data logic.
- Frontend usage: API client wrappers, components, user feedback states.
- Tests: backend integration tests, frontend component/API tests.
- Runtime verification: compose stack smoke checks for key endpoints.

## Commands

```bash
cargo test --manifest-path backend/Cargo.toml
npm --prefix frontend run test
npm --prefix frontend run lint
./scripts/test-all.sh
```

## Guardrails

- Avoid breaking existing endpoint behavior unless explicitly requested.
- Preserve path traversal protections and `EXPLORER_ROOT` constraints.
- Keep UI loading/error states explicit for all modified API calls.
- Add tests for each changed cross-layer behavior.

## References

- Full-stack change checklist: `references/full-stack-checklist.md`
