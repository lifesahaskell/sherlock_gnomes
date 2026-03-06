import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "./route";

describe("PUT /api/internal/profiles/:id", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("EXPLORER_ADMIN_API_KEY", "admin-key");
    vi.stubEnv("EXPLORER_BACKEND_API_BASE", "http://backend:8787");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("proxies profile updates with admin key", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 2,
          display_name: "Grace Hopper",
          email: "grace.hopper@example.com",
          bio: "Compiler",
          created_at: "2026-03-06T00:00:00Z"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    const request = new Request("http://localhost/api/internal/profiles/2", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: " grace.hopper@example.com "
      })
    });

    const response = await PUT(request, { params: { id: "2" } });
    const payload = (await response.json()) as { id: number };
    expect(response.status).toBe(200);
    expect(payload.id).toBe(2);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://backend:8787/api/profiles/2");
    expect((options as RequestInit).method).toBe("PUT");
    const headers = new Headers((options as RequestInit).headers as HeadersInit | undefined);
    expect(headers.get("x-api-key")).toBe("admin-key");
    expect((options as RequestInit).body).toBe(
      JSON.stringify({
        email: "grace.hopper@example.com"
      })
    );
  });

  it("rejects non-numeric ids", async () => {
    const request = new Request("http://localhost/api/internal/profiles/abc", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "grace@example.com"
      })
    });

    const response = await PUT(request, { params: { id: "abc" } });
    const payload = (await response.json()) as { error: string };
    expect(response.status).toBe(400);
    expect(payload.error).toContain("positive integer");
  });
});
