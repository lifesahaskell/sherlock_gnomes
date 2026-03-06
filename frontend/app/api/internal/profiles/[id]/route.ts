import { NextResponse } from "next/server";
import { UpdateUserProfileInput } from "@/lib/api";

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

function sanitizeUpdatePayload(input: Partial<UpdateUserProfileInput>): UpdateUserProfileInput | null {
  const output: UpdateUserProfileInput = {};

  if ("display_name" in input) {
    if (typeof input.display_name !== "string" || !input.display_name.trim()) {
      return null;
    }
    output.display_name = input.display_name.trim();
  }

  if ("email" in input) {
    if (typeof input.email !== "string" || !input.email.trim()) {
      return null;
    }
    output.email = input.email.trim();
  }

  if ("bio" in input) {
    if (typeof input.bio !== "string") {
      return null;
    }
    output.bio = input.bio.trim();
  }

  return Object.keys(output).length > 0 ? output : null;
}

export async function PUT(
  request: Request,
  context: { params: { id: string } | Promise<{ id: string }> }
): Promise<NextResponse> {
  const params = await Promise.resolve(context.params);
  const profileId = params.id.trim();
  if (!/^\d+$/.test(profileId)) {
    return jsonError(400, "Profile id must be a positive integer.");
  }

  const key = adminApiKey();
  if (!key) {
    return jsonError(500, "EXPLORER_ADMIN_API_KEY is not configured for profile writes.");
  }

  const body = (await request.json().catch(() => null)) as Partial<UpdateUserProfileInput> | null;
  if (!body) {
    return jsonError(400, "Request body must be valid JSON.");
  }

  const payload = sanitizeUpdatePayload(body);
  if (!payload) {
    return jsonError(400, "At least one valid profile field is required.");
  }

  try {
    const response = await fetch(`${backendBaseUrl()}/api/profiles/${profileId}`, {
      method: "PUT",
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
