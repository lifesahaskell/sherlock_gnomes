CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS index_jobs (
    id uuid PRIMARY KEY,
    status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    requested_at timestamptz NOT NULL DEFAULT NOW(),
    started_at timestamptz,
    finished_at timestamptz,
    files_scanned bigint NOT NULL DEFAULT 0,
    files_indexed bigint NOT NULL DEFAULT 0,
    blocks_indexed bigint NOT NULL DEFAULT 0,
    error text
);

CREATE TABLE IF NOT EXISTS indexed_files (
    path text PRIMARY KEY,
    content_hash text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS semantic_blocks (
    id bigserial PRIMARY KEY,
    path text NOT NULL,
    start_line integer NOT NULL,
    end_line integer NOT NULL,
    content text NOT NULL,
    snippet text NOT NULL,
    embedding vector(1536) NOT NULL,
    content_hash text NOT NULL,
    keyword_tsv tsvector GENERATED ALWAYS AS (
        to_tsvector('simple'::regconfig, coalesce(content, ''))
    ) STORED,
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (path, start_line, end_line)
);

CREATE INDEX IF NOT EXISTS semantic_blocks_path_idx
    ON semantic_blocks (path);

CREATE INDEX IF NOT EXISTS semantic_blocks_keyword_idx
    ON semantic_blocks USING GIN (keyword_tsv);

CREATE INDEX IF NOT EXISTS semantic_blocks_embedding_idx
    ON semantic_blocks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
