import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("session configuration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exports sessionOptions with correct cookie name", async () => {
    vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long!");

    const { sessionOptions } = await import("@/lib/session");
    expect(sessionOptions.cookieName).toBe("sherlock_session");
  });

  it("uses SESSION_SECRET from environment", async () => {
    const secret = "a-secret-that-is-at-least-32-characters-long!";
    vi.stubEnv("SESSION_SECRET", secret);

    const { sessionOptions } = await import("@/lib/session");
    expect(sessionOptions.password).toBe(secret);
  });

  it("sets httpOnly and sameSite lax on cookies", async () => {
    vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long!");

    const { sessionOptions } = await import("@/lib/session");
    expect(sessionOptions.cookieOptions?.httpOnly).toBe(true);
    expect(sessionOptions.cookieOptions?.sameSite).toBe("lax");
  });

  it("sets maxAge to 24 hours (86400 seconds)", async () => {
    vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long!");

    const { sessionOptions } = await import("@/lib/session");
    expect(sessionOptions.cookieOptions?.maxAge).toBe(86400);
  });

  it("throws an error if SESSION_SECRET is not set and auth is not disabled", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("LOGIN_AUTH_DISABLED", "false");

    await expect(import("@/lib/session")).rejects.toThrow(/SESSION_SECRET/);
  });

  it("throws an error if SESSION_SECRET is too short", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    vi.stubEnv("LOGIN_AUTH_DISABLED", "false");

    await expect(import("@/lib/session")).rejects.toThrow(/SESSION_SECRET/);
  });

  it("does not throw if SESSION_SECRET is missing but LOGIN_AUTH_DISABLED is true", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("LOGIN_AUTH_DISABLED", "true");

    const mod = await import("@/lib/session");
    // Should still export sessionOptions (with a placeholder password)
    expect(mod.sessionOptions).toBeDefined();
  });

  it("exports SessionData type interface", async () => {
    vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long!");

    const mod = await import("@/lib/session");
    // sessionOptions should exist and be usable
    expect(mod.sessionOptions.cookieName).toBeTruthy();
  });
});
