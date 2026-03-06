import { UpdateUserProfileInput, UserProfile } from "@/lib/api";

type CreateProfileInput = {
  display_name: string;
  email: string;
  bio?: string;
};

async function fetchJsonFromInternalApi<T>(
  path: string,
  method: "POST" | "PUT",
  payload: unknown
): Promise<T> {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");

  const response = await fetch(path, {
    method,
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

export function createProfileAdmin(input: CreateProfileInput): Promise<UserProfile> {
  return fetchJsonFromInternalApi<UserProfile>("/api/internal/profiles", "POST", input);
}

export function updateProfileAdmin(
  id: number,
  input: UpdateUserProfileInput
): Promise<UserProfile> {
  return fetchJsonFromInternalApi<UserProfile>(`/api/internal/profiles/${id}`, "PUT", input);
}
