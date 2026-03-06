import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProfileAdmin, updateProfileAdmin } from "@/lib/profile-admin";

describe("profile-admin client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends create requests to internal profile endpoint", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 1,
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

    await createProfileAdmin({
      display_name: "Ada",
      email: "ada@example.com",
      bio: "Pioneer"
    });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/internal/profiles");
    expect((options as RequestInit).method).toBe("POST");
    expect((options as RequestInit).body).toBe(
      JSON.stringify({
        display_name: "Ada",
        email: "ada@example.com",
        bio: "Pioneer"
      })
    );
  });

  it("sends update requests to internal profile id endpoint", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 2,
          display_name: "Grace Hopper",
          email: "grace@example.com",
          bio: "Compiler",
          created_at: "2026-03-06T00:00:00Z"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await updateProfileAdmin(2, { email: "grace@example.com" });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/internal/profiles/2");
    expect((options as RequestInit).method).toBe("PUT");
    expect((options as RequestInit).body).toBe(JSON.stringify({ email: "grace@example.com" }));
  });

  it("surfaces backend error payloads", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(
      updateProfileAdmin(2, {
        email: "grace@example.com"
      })
    ).rejects.toThrow("forbidden");
  });
});
