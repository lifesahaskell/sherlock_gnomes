export type SessionData = {
  username: string;
  loggedInAt: number;
};

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim() ?? "";

  if (secret.length < 32) {
    if (process.env.LOGIN_AUTH_DISABLED === "true") {
      // Return a placeholder when auth is disabled so the module can load
      return "placeholder-secret-auth-disabled-placeholder!";
    }
    throw new Error(
      "SESSION_SECRET environment variable must be set to a string of at least 32 characters."
    );
  }

  return secret;
}

export function getSessionOptions() {
  return {
    password: getSessionSecret(),
    cookieName: "sherlock_session",
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 86400, // 24 hours in seconds
    },
  };
}
