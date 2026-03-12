import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

describe("auth credentials (bcrypt)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("verifyCredentials", () => {
    it("accepts valid username and password with bcrypt hash", async () => {
      const hash = bcrypt.hashSync("secret123", 10);
      vi.stubEnv("LOGIN_USERNAME", "admin");
      vi.stubEnv("LOGIN_PASSWORD_HASH", hash);

      const { verifyCredentials } = await import("@/lib/auth");
      expect(await verifyCredentials("admin", "secret123")).toBe(true);
    });

    it("rejects wrong password", async () => {
      const hash = bcrypt.hashSync("secret123", 10);
      vi.stubEnv("LOGIN_USERNAME", "admin");
      vi.stubEnv("LOGIN_PASSWORD_HASH", hash);

      const { verifyCredentials } = await import("@/lib/auth");
      expect(await verifyCredentials("admin", "wrong-password")).toBe(false);
    });

    it("rejects wrong username even with correct password", async () => {
      const hash = bcrypt.hashSync("secret123", 10);
      vi.stubEnv("LOGIN_USERNAME", "admin");
      vi.stubEnv("LOGIN_PASSWORD_HASH", hash);

      const { verifyCredentials } = await import("@/lib/auth");
      expect(await verifyCredentials("notadmin", "secret123")).toBe(false);
    });

    it("uses custom username from LOGIN_USERNAME env var", async () => {
      const hash = bcrypt.hashSync("pass", 10);
      vi.stubEnv("LOGIN_USERNAME", "sherlock");
      vi.stubEnv("LOGIN_PASSWORD_HASH", hash);

      const { verifyCredentials } = await import("@/lib/auth");
      expect(await verifyCredentials("sherlock", "pass")).toBe(true);
      expect(await verifyCredentials("admin", "pass")).toBe(false);
    });

    it("rejects all credentials when no password hash is configured", async () => {
      vi.stubEnv("LOGIN_USERNAME", "admin");
      vi.stubEnv("LOGIN_PASSWORD_HASH", "");

      const { verifyCredentials } = await import("@/lib/auth");
      expect(await verifyCredentials("admin", "anything")).toBe(false);
    });

    it("rejects all credentials when LOGIN_USERNAME is not set", async () => {
      const hash = bcrypt.hashSync("secret123", 10);
      vi.stubEnv("LOGIN_PASSWORD_HASH", hash);

      const { verifyCredentials } = await import("@/lib/auth");
      expect(await verifyCredentials("admin", "secret123")).toBe(false);
    });

    it("rejects username of different length without short-circuiting", async () => {
      const hash = bcrypt.hashSync("secret123", 10);
      vi.stubEnv("LOGIN_USERNAME", "admin");
      vi.stubEnv("LOGIN_PASSWORD_HASH", hash);

      const { verifyCredentials } = await import("@/lib/auth");
      // Even a very short or very long username should still be rejected
      // (tests that timing-safe comparison handles length mismatch)
      expect(await verifyCredentials("a", "secret123")).toBe(false);
      expect(await verifyCredentials("administrator", "secret123")).toBe(false);
    });
  });
});
