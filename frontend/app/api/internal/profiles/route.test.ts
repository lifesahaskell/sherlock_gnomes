import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

describe("POST /api/internal/profiles", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("EXPLORER_ADMIN_API_KEY", "admin-key");
    vi.stubEnv("EXPLORER_BACKEND_API_BASE", "http://backend:8787");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("proxies profile creation with admin key", async () => {
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

  it("returns 500 when admin key is missing", async () => {
    vi.stubEnv("EXPLORER_ADMIN_API_KEY", "");

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
