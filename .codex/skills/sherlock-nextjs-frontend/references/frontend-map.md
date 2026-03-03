# Frontend Map

## Core files

- `frontend/app/page.tsx`: Main explorer page and orchestration UI.
- `frontend/app/layout.tsx`: App shell.
- `frontend/app/globals.css`: Global styling.
- `frontend/components/explorer.tsx`: Primary explorer interaction component.
- `frontend/components/explorer.test.tsx`: Explorer behavior tests.
- `frontend/lib/api.ts`: Backend API wrappers.
- `frontend/lib/api.test.ts`: API wrapper tests.
- `frontend/test/setup.ts`: Vitest setup.

## Runtime assumptions

- Local dev default frontend: `http://127.0.0.1:3000`.
- Backend target configured via `NEXT_PUBLIC_API_BASE`.

## Definition of done for frontend tasks

- Lint and tests pass.
- Loading/error/empty states are handled.
- API request/response mapping is consistent with backend.
- Changed behavior is covered by tests.
