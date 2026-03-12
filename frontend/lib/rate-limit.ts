const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;
const MAX_MAP_ENTRIES = 10_000;

const attempts = new Map<string, number[]>();

function sweepStaleEntries(now: number): void {
  if (attempts.size <= MAX_MAP_ENTRIES) return;

  const windowStart = now - WINDOW_MS;
  for (const [key, timestamps] of attempts) {
    if (timestamps.every((t) => t <= windowStart)) {
      attempts.delete(key);
    }
  }
}

export function checkRateLimit(ip: string): {
  allowed: boolean;
  retryAfterSeconds?: number;
} {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  sweepStaleEntries(now);

  // Get existing attempts and filter to only those within the window
  const existing = attempts.get(ip) ?? [];
  const recent = existing.filter((t) => t > windowStart);

  if (recent.length >= MAX_ATTEMPTS) {
    // Calculate when the oldest attempt in the window will expire
    const oldestInWindow = recent[0];
    const retryAfterMs = oldestInWindow + WINDOW_MS - now;
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

    return { allowed: false, retryAfterSeconds };
  }

  recent.push(now);
  attempts.set(ip, recent);

  return { allowed: true };
}
