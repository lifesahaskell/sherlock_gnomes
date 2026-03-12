import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/health", "/api/auth/", "/_next/", "/favicon.ico"];
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p)
  );
}

function copySetCookieHeaders(source: Headers, target: Headers): void {
  const headersWithGetSetCookie = source as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headersWithGetSetCookie.getSetCookie === "function") {
    for (const value of headersWithGetSetCookie.getSetCookie()) {
      target.append("set-cookie", value);
    }
    return;
  }

  const value = source.get("set-cookie");
  if (value) {
    target.set("set-cookie", value);
  }
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

  const response = NextResponse.next();
  const session = await getIronSession<SessionData>(request, response, getSessionOptions());

  if (!session.username) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Enforce server-side session expiry (24 hours)
  if (session.loggedInAt && Date.now() - session.loggedInAt > SESSION_TTL_MS) {
    session.destroy();
    const redirect = NextResponse.redirect(new URL("/login", request.url));
    copySetCookieHeaders(response.headers, redirect.headers);
    return redirect;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
