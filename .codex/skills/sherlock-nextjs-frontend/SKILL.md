---
name: sherlock-nextjs-frontend
description: Implement, refactor, and debug the Sherlock Gnomes Next.js frontend (App Router + React + Vitest). Use when tasks touch `frontend/app`, `frontend/components`, `frontend/lib`, frontend state/UI behavior, API client integration, styling, or frontend tests/lint.
---

# Sherlock Next.js Frontend

Use this skill to deliver UI changes that stay aligned with backend API behavior.

## Workflow

1. Identify impacted route/component and related tests.
2. Confirm API shape in `frontend/lib/api.ts` and backend endpoint contracts.
3. Implement component and state updates with accessible, deterministic UI behavior.
4. Update tests in `frontend/components/*.test.tsx` or `frontend/lib/*.test.ts`.
5. Run frontend checks, then cross-stack checks when needed.

## Commands

```bash
npm --prefix frontend run lint
npm --prefix frontend run test
```

For integration-impacting changes:

```bash
./scripts/test-all.sh
```

## Guardrails

- Keep API base behavior consistent with `NEXT_PUBLIC_API_BASE`.
- Avoid silent error swallowing; surface meaningful UI error states.
- Preserve explorer/search/index flows in the main page experience.
- Add tests for changed user-visible behavior.

## References

- Frontend structure and test surface: `references/frontend-map.md`
