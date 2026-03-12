CREATE TABLE IF NOT EXISTS git_repositories (
    id uuid PRIMARY KEY,
    path text NOT NULL UNIQUE,
    name text NOT NULL,
    head_commit text NOT NULL,
    branch text,
    is_dirty boolean NOT NULL DEFAULT false,
    tracked_file_count bigint NOT NULL DEFAULT 0,
    stored_file_count bigint NOT NULL DEFAULT 0,
    skipped_binary_files bigint NOT NULL DEFAULT 0,
    skipped_large_files bigint NOT NULL DEFAULT 0,
    total_bytes bigint NOT NULL DEFAULT 0,
    analysis_summary text NOT NULL DEFAULT '',
    imported_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS git_repository_files (
    repository_id uuid NOT NULL REFERENCES git_repositories(id) ON DELETE CASCADE,
    path text NOT NULL,
    content text NOT NULL,
    content_hash text NOT NULL,
    size_bytes bigint NOT NULL,
    line_count integer NOT NULL,
    language text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (repository_id, path)
);

CREATE INDEX IF NOT EXISTS git_repository_files_repository_id_path_idx
    ON git_repository_files (repository_id, path);

CREATE TABLE IF NOT EXISTS git_repository_language_stats (
    repository_id uuid NOT NULL REFERENCES git_repositories(id) ON DELETE CASCADE,
    language text NOT NULL,
    file_count bigint NOT NULL DEFAULT 0,
    total_bytes bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (repository_id, language)
);
