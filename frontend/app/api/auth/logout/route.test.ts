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

  it("destroys the session and returns 200", async () => {
    const { POST } = await import("./route");

    const response = await POST();
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDestroy).toHaveBeenCalled();
  });
});
