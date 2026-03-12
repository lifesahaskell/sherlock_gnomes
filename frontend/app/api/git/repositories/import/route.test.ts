import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetIronSession = vi.fn();
vi.mock("iron-session", () => ({
  getIronSession: (...args: unknown[]) => mockGetIronSession(...args)
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({})
}));

describe("POST /api/git/repositories/import", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("EXPLORER_ADMIN_API_KEY", "admin-key");
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

  it("proxies repository imports with the server-side admin key", async () => {
    const { POST } = await import("./route");
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "repo-1",
          path: "sample-repo",
          name: "sample-repo"
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    const request = new Request("http://localhost/api/git/repositories/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "sample-repo" })
    });
    const response = await POST(request);

    expect(response.status).toBe(201);

    const [url, options] = mockFetch.mock.calls[0];
    expect(String(url)).toBe("http://backend:8787/api/git/repositories/import");
    expect((options as RequestInit).method).toBe("POST");
    expect((options as RequestInit).body).toBe(JSON.stringify({ source: "sample-repo" }));
    const headers = new Headers((options as RequestInit).headers as HeadersInit | undefined);
    expect(headers.get("x-api-key")).toBe("admin-key");
    expect(headers.get("content-type")).toBe("application/json");
  });
});
