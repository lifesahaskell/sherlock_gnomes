import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/health", "/api/auth/", "/_next/", "/favicon.ico"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p)
  );
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // Skip auth entirely when disabled via env var
  if (process.env.LOGIN_AUTH_DISABLED === "true") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Allow public paths without auth
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check for valid iron-session
  const session = await getIronSession<SessionData>(
    request.cookies,
    sessionOptions
  );

  if (!session.username) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Enforce server-side session expiry (24 hours)
  if (session.loggedInAt && Date.now() - session.loggedInAt > 24 * 60 * 60 * 1000) {
    session.destroy();
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
