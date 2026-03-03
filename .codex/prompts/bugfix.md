# Bugfix Prompt

Fix a bug in `sherlock_gnomes` with minimal regression risk.

## Bug report

- Observed behavior: <what is wrong>
- Expected behavior: <what should happen>
- Repro steps: <steps>
- Suspected area: <files/modules>

## Requirements

- Reproduce or validate failure condition first.
- Implement smallest safe fix.
- Add/adjust tests to prevent recurrence.
- Call out root cause.

## Validation

- Run focused package tests.
- Run lint/checks for touched area.
- If cross-stack impact exists, run `./scripts/test-all.sh`.

## Deliverables

- Root cause summary.
- Fix summary.
- Test evidence summary.
