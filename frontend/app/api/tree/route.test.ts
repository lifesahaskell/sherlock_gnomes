import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetIronSession = vi.fn();
vi.mock("iron-session", () => ({
  getIronSession: (...args: unknown[]) => mockGetIronSession(...args),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({}),
}));

describe("GET /api/tree", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("EXPLORER_READ_API_KEY", "read-key");
    vi.stubEnv("EXPLORER_BACKEND_API_BASE", "http://backend:8787");
    vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long!");
    mockGetIronSession.mockResolvedValue({
      username: "admin",
      loggedInAt: Date.now(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    mockGetIronSession.mockReset();
  });

  it("proxies tree reads through the frontend with the server-side read key", async () => {
    const { GET } = await import("./route");
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ path: "", entries: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const request = new Request("http://localhost/api/tree?path=src/components");
    const response = await GET(request);

    expect(response.status).toBe(200);

    const [url, options] = mockFetch.mock.calls[0];
    expect(String(url)).toBe("http://backend:8787/api/tree?path=src/components");
    expect((options as RequestInit).method).toBe("GET");
    expect((options as RequestInit).cache).toBe("no-store");
    const headers = new Headers((options as RequestInit).headers as HeadersInit | undefined);
    expect(headers.get("x-api-key")).toBe("read-key");
  });

  it("returns 401 when session authentication is required and missing", async () => {
    mockGetIronSession.mockResolvedValue({});

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/tree?path=src"));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(payload.error).toContain("Authentication required");
  });

  it("returns 500 when the read API key is not configured", async () => {
    vi.stubEnv("EXPLORER_READ_API_KEY", "");

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/tree?path=src"));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(payload.error).toContain("EXPLORER_READ_API_KEY");
  });
});
