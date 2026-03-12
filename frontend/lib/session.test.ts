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

    const { getSessionOptions } = await import("@/lib/session");
    const sessionOptions = getSessionOptions();
    expect(sessionOptions.cookieName).toBe("sherlock_session");
  });

  it("uses SESSION_SECRET from environment", async () => {
    const secret = "a-secret-that-is-at-least-32-characters-long!";
    vi.stubEnv("SESSION_SECRET", secret);

    const { getSessionOptions } = await import("@/lib/session");
    const sessionOptions = getSessionOptions();
    expect(sessionOptions.password).toBe(secret);
  });

  it("sets httpOnly and sameSite lax on cookies", async () => {
    vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long!");

    const { getSessionOptions } = await import("@/lib/session");
    const sessionOptions = getSessionOptions();
    expect(sessionOptions.cookieOptions?.httpOnly).toBe(true);
    expect(sessionOptions.cookieOptions?.sameSite).toBe("lax");
  });

  it("sets maxAge to 24 hours (86400 seconds)", async () => {
    vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long!");

    const { getSessionOptions } = await import("@/lib/session");
    const sessionOptions = getSessionOptions();
    expect(sessionOptions.cookieOptions?.maxAge).toBe(86400);
  });

  it("throws when session options are requested without SESSION_SECRET", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("LOGIN_AUTH_DISABLED", "false");

    const { getSessionOptions } = await import("@/lib/session");
    expect(() => getSessionOptions()).toThrow(/SESSION_SECRET/);
  });

  it("throws when session options are requested with a short SESSION_SECRET", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    vi.stubEnv("LOGIN_AUTH_DISABLED", "false");

    const { getSessionOptions } = await import("@/lib/session");
    expect(() => getSessionOptions()).toThrow(/SESSION_SECRET/);
  });

  it("allows session option creation with a placeholder secret when auth is disabled", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("LOGIN_AUTH_DISABLED", "true");

    const mod = await import("@/lib/session");
    expect(mod.getSessionOptions).toBeDefined();
    expect(mod.getSessionOptions().password).toContain("placeholder");
  });

  it("exports SessionData type interface", async () => {
    vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long!");

    const mod = await import("@/lib/session");
    expect(mod.getSessionOptions().cookieName).toBeTruthy();
  });

  it("does not require SESSION_SECRET just to import the module", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("LOGIN_AUTH_DISABLED", "false");

    await expect(import("@/lib/session")).resolves.toBeDefined();
  });
});
