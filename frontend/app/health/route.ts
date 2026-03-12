import { forwardBackendJsonRequest } from "@/lib/backend-proxy";

export async function GET(request: Request) {
  return forwardBackendJsonRequest(request, {
    backendPath: "/health",
    scope: "public",
    requireSession: false,
  });
}
