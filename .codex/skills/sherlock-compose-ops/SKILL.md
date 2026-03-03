---
name: sherlock-compose-ops
description: Operate Sherlock Gnomes local stack and delivery checks using Docker Compose, environment variables, and test scripts. Use when tasks involve `docker-compose.yml`, service startup/teardown, Postgres/pgvector readiness, indexing runbooks, or CI-style lint/test verification.
---

# Sherlock Compose Ops

Use this skill for local runtime operations and release-safety checks.

## Workflow

1. Validate env vars and service dependencies before startup.
2. Start or rebuild with Docker Compose.
3. Verify service health and endpoint reachability.
4. Run indexing/search smoke checks when backend/data flows change.
5. Run CI-equivalent lint and tests before handoff.

## Commands

```bash
docker compose up --build -d
docker compose down
docker compose logs --tail=200 backend
docker compose logs --tail=200 frontend
docker compose logs --tail=200 postgres
./scripts/test-all.sh
```

## Guardrails

- Keep backend bind mount read-only (`./:/workspace:ro`).
- Treat `OPENAI_API_KEY` as optional local secret; never hardcode.
- Ensure Postgres is ready before invoking index/search operations.
- Prefer deterministic smoke checks over manual UI-only validation.

## References

- Service/env/runbook details: `references/ops-runbook.md`
