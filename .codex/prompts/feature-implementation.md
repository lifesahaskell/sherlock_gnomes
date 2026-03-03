# Feature Implementation Prompt

Implement a feature in `sherlock_gnomes`.

## Goal

- Feature: <describe feature>
- User outcome: <what user can do after change>

## Scope

- Allowed files: <paths>
- Out of scope: <paths/behaviors>

## Constraints

- Keep API compatibility unless explicitly noted.
- Add/adjust tests for changed behavior.
- Run relevant checks before finishing.

## Validation

- Backend: `cargo test --manifest-path backend/Cargo.toml`
- Frontend: `npm --prefix frontend run test`
- Optional full suite: `./scripts/test-all.sh`

## Deliverables

- Code changes with brief rationale.
- Test updates.
- Risk notes and any follow-up tasks.
