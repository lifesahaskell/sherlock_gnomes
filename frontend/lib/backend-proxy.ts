import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { validateOrigin } from "@/lib/csrf";
import { getSessionOptions, type SessionData } from "@/lib/session";

const DEFAULT_BACKEND_BASE = "http://127.0.0.1:8787";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type BackendScope = "public" | "read" | "admin";

function responseHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set("Cache-Control", "no-store");
  return headers;
}

export function jsonError(status: number, error: string, headers?: HeadersInit): NextResponse {
  return NextResponse.json(
    { error },
    {
      status,
      headers: responseHeaders(headers),
    }
  );
}

export async function relayJsonResponse(response: Response): Promise<NextResponse> {
  const headers = responseHeaders();
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    headers.set("Retry-After", retryAfter);
  }

  const payload = await response.text();
  if (!payload) {
    return new NextResponse(null, { status: response.status, headers });
  }

  try {
    return NextResponse.json(JSON.parse(payload), {
      status: response.status,
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: payload || `Request failed (${response.status})` },
      { status: response.status, headers }
    );
  }
}

export function backendBaseUrl(): string {
  return process.env.EXPLORER_BACKEND_API_BASE?.trim() || DEFAULT_BACKEND_BASE;
}

function apiKeyEnvName(scope: Exclude<BackendScope, "public">): string {
  return scope === "read" ? "EXPLORER_READ_API_KEY" : "EXPLORER_ADMIN_API_KEY";
}

export function backendApiKey(scope: BackendScope): string | null {
  if (scope === "public") {
    return null;
  }

  const key = process.env[apiKeyEnvName(scope)]?.trim();
  return key && key.length > 0 ? key : null;
}

function loginAuthDisabled(): boolean {
  return process.env.LOGIN_AUTH_DISABLED === "true";
}

export async function ensureAuthenticatedRequest(
  request: Request,
  options?: { requireCsrf?: boolean }
): Promise<NextResponse | null> {
  if (options?.requireCsrf && !validateOrigin(request)) {
    return jsonError(403, "CSRF validation failed");
  }

  if (loginAuthDisabled()) {
    return null;
  }

  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());

  if (!session.username) {
    return jsonError(401, "Authentication required.");
  }

  if (session.loggedInAt && Date.now() - session.loggedInAt > SESSION_TTL_MS) {
    if ("destroy" in session && typeof session.destroy === "function") {
      session.destroy();
    }
    return jsonError(401, "Authentication required.");
  }

  return null;
}

export async function forwardBackendJsonRequest(
  request: Request,
  options: {
    backendPath: string;
    scope: BackendScope;
    requireCsrf?: boolean;
    requireSession?: boolean;
  }
): Promise<NextResponse> {
  if (options.requireSession !== false) {
    const accessError = await ensureAuthenticatedRequest(request, {
      requireCsrf: options.requireCsrf,
    });
    if (accessError) {
      return accessError;
    }
  } else if (options.requireCsrf && !validateOrigin(request)) {
    return jsonError(403, "CSRF validation failed");
  }

  const apiKey = backendApiKey(options.scope);
  if (options.scope !== "public" && !apiKey) {
    return jsonError(
      500,
      `${apiKeyEnvName(options.scope)} is not configured for backend proxy requests.`
    );
  }

  const headers = new Headers();
  if (apiKey) {
    headers.set("x-api-key", apiKey);
  }

  const method = request.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers,
    cache: "no-store",
  };

  if (method !== "GET" && method !== "HEAD") {
    const body = await request.text();
    const contentType = request.headers.get("content-type");
    if (contentType) {
      headers.set("content-type", contentType);
    }
    init.body = body;
  }

  try {
    const response = await fetch(new URL(options.backendPath, backendBaseUrl()), init);
    return relayJsonResponse(response);
  } catch {
    return jsonError(502, "Failed to reach backend service.");
  }
}
