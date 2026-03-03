# Full-Stack Checklist

## Contract alignment

- Confirm backend endpoint path and method.
- Confirm request body/query/path params.
- Confirm success payload fields and types.
- Confirm error status codes and payload shape.

## Backend scope

- `backend/src/main.rs` route registration and server config.
- `backend/src/lib.rs` app state and handlers.
- `backend/src/indexing/*` for indexing/hybrid search behavior.
- `backend/tests/api.rs` integration behavior.
- `backend/migrations/*` for schema changes.

## Frontend scope

- `frontend/lib/api.ts` backend request wrappers.
- `frontend/lib/api.test.ts` API wrapper tests.
- `frontend/components/explorer.tsx` interaction behavior.
- `frontend/components/explorer.test.tsx` UI behavior tests.
- `frontend/app/page.tsx` orchestration/state.

## Verify before handoff

- Backend tests pass.
- Frontend lint and tests pass.
- For broad changes, `./scripts/test-all.sh` passes.
- If runtime changes are involved, verify compose smoke endpoints.
