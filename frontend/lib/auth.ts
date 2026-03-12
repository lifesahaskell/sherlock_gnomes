import crypto from "node:crypto";
import bcrypt from "bcryptjs";

function getExpectedUsername(): string {
  return process.env.LOGIN_USERNAME?.trim() || "admin";
}

function getExpectedPasswordHash(): string | null {
  const hash = process.env.LOGIN_PASSWORD_HASH?.trim();
  return hash && hash.length > 0 ? hash : null;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");

  if (bufA.length !== bufB.length) {
    // Compare against itself to keep constant time, then return false
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyCredentials(username: string, password: string): boolean {
  const expectedHash = getExpectedPasswordHash();
  if (!expectedHash) {
    return false;
  }

  const expectedUsername = getExpectedUsername();
  const usernameMatch = timingSafeStringEqual(username, expectedUsername);

  const passwordMatch = bcrypt.compareSync(password, expectedHash);

  return usernameMatch && passwordMatch;
}
