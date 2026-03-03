import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askCodebase,
  getFile,
  getHealth,
  getIndexStatus,
  getTree,
  searchCode,
  searchHybrid,
  startIndexing
} from "@/lib/api";

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

    const calledUrl = new URL(String(mockFetch.mock.calls[0][0]));
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

    const calledUrl = new URL(String(mockFetch.mock.calls[0][0]));
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

    const calledUrl = new URL(String(mockFetch.mock.calls[0][0]));
    expect(calledUrl.pathname).toBe("/health");
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

    const calledUrl = new URL(String(mockFetch.mock.calls[0][0]));
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

    const calledUrl = new URL(String(mockFetch.mock.calls[0][0]));
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

    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/ask",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ question: "What changed?", paths: ["src/main.rs"] }),
        headers: expect.objectContaining({ "Content-Type": "application/json" })
      })
    );
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

    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/index",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
        headers: expect.objectContaining({ "Content-Type": "application/json" })
      })
    );
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

    const calledUrl = new URL(String(mockFetch.mock.calls[0][0]));
    expect(calledUrl.pathname).toBe("/api/index/status");
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
