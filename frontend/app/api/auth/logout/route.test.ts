import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock iron-session
const mockDestroy = vi.fn();
const mockGetIronSession = vi.fn().mockResolvedValue({
  destroy: mockDestroy,
});
vi.mock("iron-session", () => ({
  getIronSession: (...args: unknown[]) => mockGetIronSession(...args),
}));

// Mock next/headers cookies()
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({}),
}));

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long!");
    mockDestroy.mockClear();
    mockGetIronSession.mockClear();
    mockGetIronSession.mockResolvedValue({ destroy: mockDestroy });
  });

  it("destroys the session and returns 200 with no-store cache header", async () => {
    const { POST } = await import("./route");

    const request = new Request("http://localhost/api/auth/logout", {
      method: "POST",
    });

    const response = await POST(request);
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDestroy).toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 403 when origin does not match host", async () => {
    const { POST } = await import("./route");

    const request = new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: {
        origin: "http://evil.com",
        host: "localhost",
      },
    });

    const response = await POST(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe("CSRF validation failed");
  });
});
