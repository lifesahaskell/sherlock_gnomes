import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetIronSession = vi.fn();
vi.mock("iron-session", () => ({
  getIronSession: (...args: unknown[]) => mockGetIronSession(...args)
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({})
}));

describe("GET /api/git/repositories/[id]/tree", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("EXPLORER_READ_API_KEY", "read-key");
    vi.stubEnv("EXPLORER_BACKEND_API_BASE", "http://backend:8787");
    vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long!");
    mockGetIronSession.mockResolvedValue({
      username: "admin",
      loggedInAt: Date.now()
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    mockGetIronSession.mockReset();
  });

  it("proxies stored repository tree reads with route params and the read key", async () => {
    const { GET } = await import("./route");
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ path: "", entries: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const request = new Request("http://localhost/api/git/repositories/repo-1/tree?path=src");
    const response = await GET(request, {
      params: Promise.resolve({ id: "repo-1" })
    });

    expect(response.status).toBe(200);

    const [url, options] = mockFetch.mock.calls[0];
    expect(String(url)).toBe("http://backend:8787/api/git/repositories/repo-1/tree?path=src");
    expect((options as RequestInit).method).toBe("GET");
    const headers = new Headers((options as RequestInit).headers as HeadersInit | undefined);
    expect(headers.get("x-api-key")).toBe("read-key");
  });
});
