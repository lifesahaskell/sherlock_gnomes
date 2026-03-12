import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

// Mock iron-session's getIronSession
const mockGetIronSession = vi.fn();
vi.mock("iron-session", () => ({
  getIronSession: (...args: unknown[]) => mockGetIronSession(...args),
}));

// Mock next/headers cookies()
const mockCookies = vi.fn().mockResolvedValue({});
vi.mock("next/headers", () => ({
  cookies: () => mockCookies(),
}));

// Mock rate limiter
const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.resetModules();
    const passwordHash = bcrypt.hashSync("secret123", 10);
    vi.stubEnv("LOGIN_PASSWORD_HASH", passwordHash);
    vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long!");

    // Default: rate limit allows
    mockCheckRateLimit.mockReturnValue({ allowed: true });

    // Default: iron-session returns a mock session object
    mockGetIronSession.mockResolvedValue({
      username: undefined,
      loggedInAt: undefined,
      save: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    mockGetIronSession.mockReset();
    mockCheckRateLimit.mockReset();
  });

  it("returns 200 and saves session for valid credentials", async () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    const mockSession = { save: mockSave } as Record<string, unknown>;
    mockGetIronSession.mockResolvedValue(mockSession);

    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret123" }),
    });

    const response = await POST(request);
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockSave).toHaveBeenCalled();
    expect(mockSession.username).toBe("admin");
    expect(mockSession.loggedInAt).toBeTypeOf("number");
  });

  it("returns 401 for invalid credentials", async () => {
    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong-password" }),
    });

    const response = await POST(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBeTruthy();
  });

  it("returns 400 for missing body fields", async () => {
    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: "not json",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 600 });

    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "1.2.3.4",
      },
      body: JSON.stringify({ username: "admin", password: "secret123" }),
    });

    const response = await POST(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(429);
    expect(body.error).toContain("Too many login attempts");
    expect(response.headers.get("Retry-After")).toBe("600");
  });

  it("accepts plain username and password (no encryption)", async () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    mockGetIronSession.mockResolvedValue({ save: mockSave } as Record<string, unknown>);

    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret123" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });
});
