import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askCodebase, getFile, getTree, searchCode } from "@/lib/api";

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
