# TDD Playbook

## Testing levels in this repo

- Unit testing: validate small isolated logic (helpers, transformations, edge-case branches).
- Integration testing: validate component/API interactions and endpoint contracts.
- Smoke testing: validate critical runtime paths end-to-end after changes.
- Acceptance testing: validate end-user success criteria across complete flows and expected outcomes.

## Step 1: frame behavior

- State expected behavior in one sentence.
- Choose the closest existing test file.
- Name test with behavior intent, not implementation detail.

## Step 2: write failing test (Red)

- Add assertion for only the next increment of behavior.
- Run just enough tests to confirm failure.
- Prefer the smallest relevant level first:
  - Unit test for local logic changes.
  - Integration test for contract and flow changes.
  - Acceptance test when behavior spans multiple steps a user would actually perform.

Suggested focused runs:

```bash
cargo test --manifest-path backend/Cargo.toml api
npm --prefix frontend run test -- explorer
```

## Step 3: minimal implementation (Green)

- Change smallest surface area needed.
- Re-run focused tests.
- Avoid incidental cleanup during green step.

## Step 4: refactor safely

- Extract helpers only when duplication is clear.
- Keep public contract unchanged unless requirement changed.
- Re-run full package tests after refactor.

## Step 5: harden

- Add edge case tests for high-risk branches.
- Confirm all relevant levels are covered:
  - Unit tests for changed internals.
  - Integration tests for changed contracts and cross-module behavior.
  - Smoke tests for critical user/runtime paths.
  - Acceptance tests for end-user scenarios and success criteria.
- Run package lint and tests.
- Run `./scripts/test-all.sh` for cross-layer changes or before handoff.

## Suggested smoke checks

```bash
curl -f http://127.0.0.1:8787/health
curl -f 'http://127.0.0.1:8787/api/tree?path='
```

## Suggested acceptance checks

1. Explorer flow: load UI, list root tree, open a file, and confirm file content renders.
2. Ask flow: select files, submit question, and confirm response is returned and shown.
3. Index/search flow: trigger index, confirm status completion, run search/hybrid search, verify relevant results.
