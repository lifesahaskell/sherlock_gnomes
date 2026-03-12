import crypto from "node:crypto";
import bcrypt from "bcryptjs";

function getExpectedUsername(): string | null {
  const username = process.env.LOGIN_USERNAME?.trim();
  return username && username.length > 0 ? username : null;
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

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  const expectedHash = getExpectedPasswordHash();
  if (!expectedHash) {
    return false;
  }

  const expectedUsername = getExpectedUsername();
  if (!expectedUsername) {
    return false;
  }

  const usernameMatch = timingSafeStringEqual(username, expectedUsername);

  const passwordMatch = await bcrypt.compare(password, expectedHash);

  return usernameMatch && passwordMatch;
}
