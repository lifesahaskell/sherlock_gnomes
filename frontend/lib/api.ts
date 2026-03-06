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

export type UserProfile = {
  id: number;
  display_name: string;
  email: string;
  bio: string;
  created_at: string;
};

export type UpdateUserProfileInput = {
  display_name?: string;
  email?: string;
  bio?: string;
};

export type HealthResponse = {
  status: string;
  root_dir: string;
  indexed_search_enabled: boolean;
  hybrid_search_enabled?: boolean;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8787";

function hasHeaders(headers: Headers): boolean {
  return headers.keys().next().done === false;
}

function readApiKeyForRequest(path: string): string | null {
  if (!path.startsWith("/api/")) {
    return null;
  }
  const key = process.env.NEXT_PUBLIC_EXPLORER_READ_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

function buildRequestHeaders(path: string, init: RequestInit | undefined): Headers | undefined {
  const method = init?.method?.toUpperCase() ?? "GET";
  const hasRequestBody = init?.body !== undefined;
  const needsJsonHeader =
    hasRequestBody || method === "POST" || method === "PUT" || method === "PATCH";
  const headers = new Headers(init?.headers ?? undefined);

  if (needsJsonHeader) {
    headers.set("Content-Type", "application/json");
  }

  const readApiKey = readApiKeyForRequest(path);
  if (readApiKey) {
    headers.set("X-API-Key", readApiKey);
  }

  return hasHeaders(headers) ? headers : undefined;
}

function buildSearchQueryString(query: string, path: string, limit: number): string {
  const params = new URLSearchParams({
    query,
    limit: String(limit)
  });
  if (path) {
    params.set("path", path);
  }
  return params.toString();
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = buildRequestHeaders(path, init);
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    ...(headers ? { headers } : {})
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
  return fetchJson<SearchResponse>(
    `/api/search?${buildSearchQueryString(query, path, limit)}`
  );
}

export function searchHybrid(
  query: string,
  path = "",
  limit = 50
): Promise<HybridSearchResponse> {
  return fetchJson<HybridSearchResponse>(
    `/api/search/hybrid?${buildSearchQueryString(query, path, limit)}`
  );
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

export function createUserProfile(input: {
  display_name: string;
  email: string;
  bio?: string;
}): Promise<UserProfile> {
  return fetchJson<UserProfile>("/api/profiles", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getUserProfiles(): Promise<UserProfile[]> {
  return fetchJson<UserProfile[]>("/api/profiles");
}

export function updateUserProfile(
  id: number,
  input: UpdateUserProfileInput
): Promise<UserProfile> {
  return fetchJson<UserProfile>(`/api/profiles/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}
