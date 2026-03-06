import { NextResponse } from "next/server";

type CreateProfilePayload = {
  display_name: string;
  email: string;
  bio?: string;
};

const DEFAULT_BACKEND_BASE = "http://127.0.0.1:8787";

function backendBaseUrl(): string {
  return (
    process.env.EXPLORER_BACKEND_API_BASE?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE?.trim() ||
    DEFAULT_BACKEND_BASE
  );
}

function adminApiKey(): string | null {
  const key = process.env.EXPLORER_ADMIN_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

async function relayJsonResponse(response: Response): Promise<NextResponse> {
  const payload = await response.text();
  if (!payload) {
    return new NextResponse(null, { status: response.status });
  }

  try {
    return NextResponse.json(JSON.parse(payload), { status: response.status });
  } catch {
    return NextResponse.json(
      { error: payload || `Request failed (${response.status})` },
      { status: response.status }
    );
  }
}

function sanitizeCreatePayload(input: Partial<CreateProfilePayload>): CreateProfilePayload | null {
  const display_name = typeof input.display_name === "string" ? input.display_name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const bio = typeof input.bio === "string" ? input.bio.trim() : "";

  if (!display_name || !email) {
    return null;
  }

  return { display_name, email, bio };
}

export async function POST(request: Request): Promise<NextResponse> {
  const key = adminApiKey();
  if (!key) {
    return jsonError(500, "EXPLORER_ADMIN_API_KEY is not configured for profile writes.");
  }

  const body = (await request.json().catch(() => null)) as Partial<CreateProfilePayload> | null;
  if (!body) {
    return jsonError(400, "Request body must be valid JSON.");
  }

  const payload = sanitizeCreatePayload(body);
  if (!payload) {
    return jsonError(400, "display_name and email are required.");
  }

  try {
    const response = await fetch(`${backendBaseUrl()}/api/profiles`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    return relayJsonResponse(response);
  } catch {
    return jsonError(502, "Failed to reach backend profile service.");
  }
}
