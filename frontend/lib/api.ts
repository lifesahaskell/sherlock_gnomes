export type TreeEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
};

export type TreeResponse = {
  path: string;
  entries: TreeEntry[];
};

export type FileResponse = {
  path: string;
  content: string;
};

export type SearchMatch = {
  path: string;
  line_number: number;
  line: string;
};

export type SearchResponse = {
  query: string;
  matches: SearchMatch[];
};

export type HybridSearchMatch = {
  path: string;
  start_line: number;
  end_line: number;
  snippet: string;
  score: number;
  sources: string[];
};

export type HybridSearchResponse = {
  query: string;
  warnings: string[];
  matches: HybridSearchMatch[];
};

export type IndexJobStatus = {
  job_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  files_scanned: number;
  files_indexed: number;
  blocks_indexed: number;
  error: string | null;
};

export type IndexStatusResponse = {
  current_job: IndexJobStatus | null;
  pending: boolean;
  last_completed_job: IndexJobStatus | null;
};

export type StartIndexingResponse = {
  job_id: string;
  status: "queued" | "running";
  replaced_pending: boolean;
};

export type AskResponse = {
  guidance: string;
  context: { path: string; preview: string }[];
};

export type HealthResponse = {
  status: string;
  root_dir: string;
  indexed_search_enabled: boolean;
  hybrid_search_enabled?: boolean;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8787";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

export function getTree(path: string): Promise<TreeResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return fetchJson<TreeResponse>(`/api/tree${query}`);
}

export function getFile(path: string): Promise<FileResponse> {
  return fetchJson<FileResponse>(`/api/file?path=${encodeURIComponent(path)}`);
}

export function getHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>("/health");
}

export function searchCode(
  query: string,
  path = "",
  limit = 50
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    query,
    limit: String(limit)
  });
  if (path) {
    params.set("path", path);
  }
  return fetchJson<SearchResponse>(`/api/search?${params.toString()}`);
}

export function searchHybrid(
  query: string,
  path = "",
  limit = 50
): Promise<HybridSearchResponse> {
  const params = new URLSearchParams({
    query,
    limit: String(limit)
  });
  if (path) {
    params.set("path", path);
  }
  return fetchJson<HybridSearchResponse>(`/api/search/hybrid?${params.toString()}`);
}

export function askCodebase(
  question: string,
  paths: string[]
): Promise<AskResponse> {
  return fetchJson<AskResponse>("/api/ask", {
    method: "POST",
    body: JSON.stringify({ question, paths })
  });
}

export function startIndexing(): Promise<StartIndexingResponse> {
  return fetchJson<StartIndexingResponse>("/api/index", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function getIndexStatus(): Promise<IndexStatusResponse> {
  return fetchJson<IndexStatusResponse>("/api/index/status");
}
