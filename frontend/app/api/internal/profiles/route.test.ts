import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock iron-session
const mockGetIronSession = vi.fn();
vi.mock("iron-session", () => ({
  getIronSession: (...args: unknown[]) => mockGetIronSession(...args),
}));

// Mock next/headers cookies()
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({}),
}));

describe("POST /api/internal/profiles", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("EXPLORER_ADMIN_API_KEY", "admin-key");
    vi.stubEnv("EXPLORER_BACKEND_API_BASE", "http://backend:8787");
    vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long!");

    // Default: valid session
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

  it("proxies profile creation with admin key", async () => {
    const { POST } = await import("./route");
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 9,
          display_name: "Ada",
          email: "ada@example.com",
          bio: "Pioneer",
          created_at: "2026-03-06T00:00:00Z"
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    const request = new Request("http://localhost/api/internal/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: " Ada ",
        email: " ada@example.com ",
        bio: " Pioneer "
      })
    });

    const response = await POST(request);
    const responsePayload = (await response.json()) as { id: number };
    expect(response.status).toBe(201);
    expect(responsePayload.id).toBe(9);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://backend:8787/api/profiles");
    expect((options as RequestInit).method).toBe("POST");
    const headers = new Headers((options as RequestInit).headers as HeadersInit | undefined);
    expect(headers.get("x-api-key")).toBe("admin-key");
    expect((options as RequestInit).body).toBe(
      JSON.stringify({
        display_name: "Ada",
        email: "ada@example.com",
        bio: "Pioneer"
      })
    );
  });

  it("returns 401 when session is not authenticated", async () => {
    mockGetIronSession.mockResolvedValue({});

    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/internal/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "Ada",
        email: "ada@example.com"
      })
    });

    const response = await POST(request);
    const payload = (await response.json()) as { error: string };
    expect(response.status).toBe(401);
    expect(payload.error).toContain("Authentication required");
  });

  it("returns 403 when origin does not match host", async () => {
    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/internal/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://evil.com",
        host: "localhost",
      },
      body: JSON.stringify({
        display_name: "Ada",
        email: "ada@example.com"
      })
    });

    const response = await POST(request);
    const payload = (await response.json()) as { error: string };
    expect(response.status).toBe(403);
    expect(payload.error).toBe("CSRF validation failed");
  });

  it("returns 500 when admin key is missing", async () => {
    vi.stubEnv("EXPLORER_ADMIN_API_KEY", "");

    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/internal/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "Ada",
        email: "ada@example.com"
      })
    });

    const response = await POST(request);
    const payload = (await response.json()) as { error: string };
    expect(response.status).toBe(500);
    expect(payload.error).toContain("EXPLORER_ADMIN_API_KEY");
  });

  it("passes through backend error payloads", async () => {
    const { POST } = await import("./route");
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "admin API key required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      })
    );

    const request = new Request("http://localhost/api/internal/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "Ada",
        email: "ada@example.com"
      })
    });

    const response = await POST(request);
    const payload = (await response.json()) as { error: string };
    expect(response.status).toBe(403);
    expect(payload.error).toBe("admin API key required");
  });
});
