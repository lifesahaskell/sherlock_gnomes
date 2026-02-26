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

export type AskResponse = {
  guidance: string;
  context: { path: string; preview: string }[];
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

export function askCodebase(
  question: string,
  paths: string[]
): Promise<AskResponse> {
  return fetchJson<AskResponse>("/api/ask", {
    method: "POST",
    body: JSON.stringify({ question, paths })
  });
}
