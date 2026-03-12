import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetIronSession = vi.fn();
vi.mock("iron-session", () => ({
  getIronSession: (...args: unknown[]) => mockGetIronSession(...args),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({}),
}));

describe("POST /api/index", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("EXPLORER_ADMIN_API_KEY", "admin-key");
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

  it("proxies index requests with the server-side admin key", async () => {
    const { POST } = await import("./route");
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ job_id: "abc", status: "queued", replaced_pending: false }),
        {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    const request = new Request("http://localhost/api/index", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const response = await POST(request);

    expect(response.status).toBe(202);

    const [url, options] = mockFetch.mock.calls[0];
    expect(String(url)).toBe("http://backend:8787/api/index");
    expect((options as RequestInit).method).toBe("POST");
    expect((options as RequestInit).body).toBe(JSON.stringify({}));
    expect((options as RequestInit).cache).toBe("no-store");
    const headers = new Headers((options as RequestInit).headers as HeadersInit | undefined);
    expect(headers.get("x-api-key")).toBe("admin-key");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("returns 403 when origin validation fails", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/index", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://evil.example",
          host: "localhost",
        },
        body: JSON.stringify({}),
      })
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe("CSRF validation failed");
  });

  it("returns 401 when session authentication is required and missing", async () => {
    mockGetIronSession.mockResolvedValue({});

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/index", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(payload.error).toContain("Authentication required");
  });
});
