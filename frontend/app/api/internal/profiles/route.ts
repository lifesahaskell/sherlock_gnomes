import { NextResponse } from "next/server";
import {
  backendApiKey,
  backendBaseUrl,
  ensureAuthenticatedRequest,
  jsonError,
  relayJsonResponse,
} from "@/lib/backend-proxy";

type CreateProfilePayload = {
  display_name: string;
  email: string;
  bio?: string;
};

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
  const accessError = await ensureAuthenticatedRequest(request, { requireCsrf: true });
  if (accessError) {
    return accessError;
  }

  const key = backendApiKey("admin");
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
