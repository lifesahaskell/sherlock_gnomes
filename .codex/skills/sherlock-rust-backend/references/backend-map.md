# Backend Map

## Core files

- `backend/src/main.rs`: Axum server wiring, routes, env config.
- `backend/src/lib.rs`: Shared app logic used by integration tests.
- `backend/src/indexing/mod.rs`: Indexing pipeline and orchestration.
- `backend/src/indexing/chunking.rs`: Source chunking for indexable units.
- `backend/src/indexing/embeddings.rs`: Embedding provider abstraction and OpenAI/mock provider logic.
- `backend/tests/api.rs`: HTTP integration tests for API contracts.
- `backend/migrations/202602260001_semantic_indexing.sql`: Search/indexing schema.

## Runtime assumptions

- `DATABASE_URL` is required for index/search endpoints.
- `EMBEDDING_PROVIDER=openai` requires `OPENAI_API_KEY`.
- `EMBEDDING_PROVIDER=mock` supports local/test workflows.

## Definition of done for backend tasks

- Build and tests pass for backend package.
- New behavior is covered by integration or targeted unit tests.
- Error responses remain structured and actionable.
- No path traversal/security regression.
