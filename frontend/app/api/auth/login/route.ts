import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { verifyCredentials } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateOrigin } from "@/lib/csrf";
import { requestClientId } from "@/lib/request-client-id";
import { getSessionOptions, type SessionData } from "@/lib/session";

type LoginPayload = {
  username: string;
  password: string;
};

function jsonError(status: number, error: string, headers?: Record<string, string>): NextResponse {
  return NextResponse.json({ error }, { status, headers });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!validateOrigin(request)) {
    return jsonError(403, "CSRF validation failed");
  }

  const body = (await request.json().catch(() => null)) as Partial<LoginPayload> | null;
  if (!body) {
    return jsonError(400, "Request body must be valid JSON.");
  }

  const { username, password } = body;
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    !username.trim() ||
    !password.trim()
  ) {
    return jsonError(400, "username and password are required.");
  }

  // Check rate limit
  const ip = requestClientId(request);
  const rateResult = checkRateLimit(ip);
  if (!rateResult.allowed) {
    return jsonError(429, "Too many login attempts. Please try again later.", {
      "Retry-After": String(rateResult.retryAfterSeconds),
    });
  }

  if (!(await verifyCredentials(username.trim(), password))) {
    return jsonError(401, "Invalid username or password.");
  }

  // Create iron-session
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());
  session.username = username.trim();
  session.loggedInAt = Date.now();
  await session.save();

  return NextResponse.json({ success: true });
}
