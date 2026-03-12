import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askCodebase,
  getFile,
  getHealth,
  getGitRepositories,
  getGitRepositoryFile,
  getGitRepositoryTree,
  getIndexStatus,
  getUserProfiles,
  getTree,
  importGitRepository,
  searchCode,
  searchHybrid,
  startIndexing
} from "@/lib/api";

describe("api client", () => {
  function requestUrl(callIndex = 0): URL {
    return new URL(String(vi.mocked(global.fetch).mock.calls[callIndex][0]), "http://localhost");
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("encodes path for getTree", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ path: "", entries: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await getTree("src/lib files");

    const calledUrl = requestUrl();
    expect(calledUrl.pathname).toBe("/api/tree");
    expect(calledUrl.searchParams.get("path")).toBe("src/lib files");
  });

  it("encodes path for getFile", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ path: "src/main.rs", content: "fn main() {}" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await getFile("src/main.rs");

    const calledUrl = requestUrl();
    expect(calledUrl.pathname).toBe("/api/file");
    expect(calledUrl.searchParams.get("path")).toBe("src/main.rs");
  });

  it("calls health endpoint", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          root_dir: ".",
          indexed_search_enabled: true,
          hybrid_search_enabled: true
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await getHealth();

    const calledUrlValue = mockFetch.mock.calls[0][0] as string;
    const calledOptions = mockFetch.mock.calls[0][1] as RequestInit | undefined;
    const calledUrl = new URL(String(calledUrlValue), "http://localhost");
    expect(calledUrl.pathname).toBe("/health");
    const headers = new Headers(calledOptions?.headers as HeadersInit | undefined);
    expect(headers.has("Content-Type")).toBe(false);
    expect(headers.has("X-API-Key")).toBe(false);
  });

  it("passes query, path, and limit for searchCode", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ query: "Alpha", matches: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await searchCode("Alpha symbol", "src", 17);

    const calledUrl = requestUrl();
    expect(calledUrl.pathname).toBe("/api/search");
    expect(calledUrl.searchParams.get("query")).toBe("Alpha symbol");
    expect(calledUrl.searchParams.get("path")).toBe("src");
    expect(calledUrl.searchParams.get("limit")).toBe("17");
  });

  it("passes query, path, and limit for searchHybrid", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ query: "Alpha", warnings: [], matches: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await searchHybrid("Alpha symbol", "src", 7);

    const calledUrl = requestUrl();
    expect(calledUrl.pathname).toBe("/api/search/hybrid");
    expect(calledUrl.searchParams.get("query")).toBe("Alpha symbol");
    expect(calledUrl.searchParams.get("path")).toBe("src");
    expect(calledUrl.searchParams.get("limit")).toBe("7");
  });

  it("sends JSON POST body for askCodebase", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ guidance: "ok", context: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await askCodebase("What changed?", ["src/main.rs"]);

    const calledUrlValue = mockFetch.mock.calls[0][0] as string;
    const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect(calledUrlValue).toBe("/api/ask");
    expect(calledOptions.method).toBe("POST");
    expect(calledOptions.body).toBe(
      JSON.stringify({ question: "What changed?", paths: ["src/main.rs"] })
    );
    const headers = new Headers(calledOptions.headers as HeadersInit | undefined);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.has("X-API-Key")).toBe(false);
  });

  it("sends JSON POST body for startIndexing", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ job_id: "abc", status: "queued", replaced_pending: false }), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      })
    );

    await startIndexing();

    const calledUrlValue = mockFetch.mock.calls[0][0] as string;
    const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect(calledUrlValue).toBe("/api/index");
    expect(calledOptions.method).toBe("POST");
    expect(calledOptions.body).toBe(JSON.stringify({}));
    const headers = new Headers(calledOptions.headers as HeadersInit | undefined);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.has("X-API-Key")).toBe(false);
  });

  it("calls index status endpoint", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          current_job: null,
          pending: false,
          last_completed_job: null
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await getIndexStatus();

    const calledUrl = requestUrl();
    expect(calledUrl.pathname).toBe("/api/index/status");
  });

  it("sends JSON POST body for importGitRepository", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "repo-1",
          path: "sample-repo",
          source_kind: "local",
          name: "sample-repo",
          head_commit: "abc123",
          branch: "main",
          is_dirty: false,
          tracked_file_count: 3,
          stored_file_count: 2,
          skipped_binary_files: 1,
          skipped_large_files: 0,
          total_bytes: 42,
          analysis_summary: "Stored 2 text files",
          imported_at: "2026-03-12T00:00:00Z",
          languages: []
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await importGitRepository("sample-repo");

    const calledUrlValue = mockFetch.mock.calls[0][0] as string;
    const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect(calledUrlValue).toBe("/api/git/repositories/import");
    expect(calledOptions.method).toBe("POST");
    expect(calledOptions.body).toBe(JSON.stringify({ source: "sample-repo" }));
    const headers = new Headers(calledOptions.headers as HeadersInit | undefined);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("calls git repository list endpoint", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await getGitRepositories();

    const calledUrl = requestUrl();
    expect(calledUrl.pathname).toBe("/api/git/repositories");
  });

  it("encodes path for getGitRepositoryTree", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ path: "src", entries: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await getGitRepositoryTree("repo-1", "src");

    const calledUrl = requestUrl();
    expect(calledUrl.pathname).toBe("/api/git/repositories/repo-1/tree");
    expect(calledUrl.searchParams.get("path")).toBe("src");
  });

  it("encodes path for getGitRepositoryFile", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          path: "src/lib.rs",
          content: "pub fn answer() -> u32 { 42 }",
          language: "Rust",
          line_count: 1
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await getGitRepositoryFile("repo-1", "src/lib.rs");

    const calledUrl = requestUrl();
    expect(calledUrl.pathname).toBe("/api/git/repositories/repo-1/file");
    expect(calledUrl.searchParams.get("path")).toBe("src/lib.rs");
  });

  it("loads user profiles", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 1,
            display_name: "Ada",
            email: "ada@example.com",
            bio: "Pioneer",
            created_at: "2026-03-06T00:00:00Z"
          }
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    const response = await getUserProfiles();

    const calledUrl = requestUrl();
    expect(calledUrl.pathname).toBe("/api/profiles");
    expect(Array.isArray(response)).toBe(true);
    expect(response[0].display_name).toBe("Ada");
  });

  it("throws backend error message when request is not ok", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "path does not exist" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(getFile("missing.txt")).rejects.toThrow("path does not exist");
  });
});
