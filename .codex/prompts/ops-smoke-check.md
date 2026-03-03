# Ops Smoke Check Prompt

Validate local stack health for `sherlock_gnomes`.

## Steps

1. Start stack: `docker compose up --build -d`
2. Verify backend health: `curl -f http://127.0.0.1:8787/health`
3. Verify explorer API: `curl -f 'http://127.0.0.1:8787/api/tree?path='`
4. Trigger indexing: `curl -f -X POST http://127.0.0.1:8787/api/index -H 'content-type: application/json' -d '{}'`
5. Check index status: `curl -f http://127.0.0.1:8787/api/index/status`
6. Run checks: `./scripts/test-all.sh`

## Report

- Service status summary.
- Endpoint results.
- Any failures with likely cause and next action.
