import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("rate limiter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first request from an IP", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const result = checkRateLimit("192.168.1.1");
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBeUndefined();
  });

  it("allows up to 5 requests from the same IP", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit("10.0.0.1");
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks the 6th request from the same IP within the window", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    for (let i = 0; i < 5; i++) {
      checkRateLimit("10.0.0.2");
    }
    const result = checkRateLimit("10.0.0.2");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks different IPs independently", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    for (let i = 0; i < 5; i++) {
      checkRateLimit("10.0.0.3");
    }
    // Different IP should still be allowed
    const result = checkRateLimit("10.0.0.4");
    expect(result.allowed).toBe(true);
  });

  it("allows requests again after the 15-minute window expires", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    for (let i = 0; i < 5; i++) {
      checkRateLimit("10.0.0.5");
    }
    expect(checkRateLimit("10.0.0.5").allowed).toBe(false);

    // Advance time by 15 minutes + 1 second
    vi.advanceTimersByTime(15 * 60 * 1000 + 1000);

    const result = checkRateLimit("10.0.0.5");
    expect(result.allowed).toBe(true);
  });

  it("uses a sliding window so old attempts expire individually", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");

    // Make 5 requests, one per minute
    for (let i = 0; i < 5; i++) {
      checkRateLimit("10.0.0.6");
      vi.advanceTimersByTime(60 * 1000); // 1 minute
    }

    // 5 minutes have passed since first request; still within 15-minute window
    expect(checkRateLimit("10.0.0.6").allowed).toBe(false);

    // Advance to 15 minutes after the FIRST request (10 more minutes)
    vi.advanceTimersByTime(10 * 60 * 1000 + 1000);

    // First request should have expired, so one slot is open
    const result = checkRateLimit("10.0.0.6");
    expect(result.allowed).toBe(true);
  });

  it("returns retryAfterSeconds based on oldest attempt in window", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    for (let i = 0; i < 5; i++) {
      checkRateLimit("10.0.0.7");
    }

    const result = checkRateLimit("10.0.0.7");
    expect(result.allowed).toBe(false);
    // Should be approximately 15 minutes (900 seconds)
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(900);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});
