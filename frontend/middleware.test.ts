import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Mock iron-session's getIronSession
const mockGetIronSession = vi.fn();
vi.mock("iron-session", () => ({
  getIronSession: (...args: unknown[]) => mockGetIronSession(...args),
}));

describe("auth middleware", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetIronSession.mockReset();
    vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long!");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows access to /login without a session", async () => {
    const { middleware } = await import("./middleware");
    const request = new NextRequest(new URL("http://localhost/login"));

    const response = await middleware(request);
    expect(response.status).not.toBe(307);
  });

  it("allows access to /health without a session", async () => {
    const { middleware } = await import("./middleware");
    const request = new NextRequest(new URL("http://localhost/health"));

    const response = await middleware(request);
    expect(response.status).not.toBe(307);
  });

  it("allows access to /api/auth routes without a session", async () => {
    const { middleware } = await import("./middleware");
    const request = new NextRequest(new URL("http://localhost/api/auth/login"));

    const response = await middleware(request);
    expect(response.status).not.toBe(307);
  });

  it("redirects to /login when no valid session exists", async () => {
    mockGetIronSession.mockResolvedValue({});

    const { middleware } = await import("./middleware");
    const request = new NextRequest(new URL("http://localhost/explorer"));

    const response = await middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("allows access when session has a username", async () => {
    mockGetIronSession.mockResolvedValue({
      username: "admin",
      loggedInAt: Date.now(),
    });

    const { middleware } = await import("./middleware");
    const request = new NextRequest(new URL("http://localhost/explorer"));

    const response = await middleware(request);
    expect(response.status).not.toBe(307);
  });

  it("redirects when session exists but username is missing", async () => {
    mockGetIronSession.mockResolvedValue({
      loggedInAt: Date.now(),
    });

    const { middleware } = await import("./middleware");
    const request = new NextRequest(new URL("http://localhost/explorer"));

    const response = await middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("redirects when session is expired (older than 24 hours)", async () => {
    const expiredTimestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    const mockDestroy = vi.fn();
    mockGetIronSession.mockResolvedValue({
      username: "admin",
      loggedInAt: expiredTimestamp,
      destroy: mockDestroy,
    });

    const { middleware } = await import("./middleware");
    const request = new NextRequest(new URL("http://localhost/explorer"));

    const response = await middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("skips auth entirely when LOGIN_AUTH_DISABLED is true", async () => {
    vi.stubEnv("LOGIN_AUTH_DISABLED", "true");
    vi.resetModules();
    mockGetIronSession.mockReset();

    const { middleware } = await import("./middleware");
    const request = new NextRequest(new URL("http://localhost/explorer"));

    const response = await middleware(request);
    expect(response.status).not.toBe(307);
    // getIronSession should NOT be called
    expect(mockGetIronSession).not.toHaveBeenCalled();
  });
});
