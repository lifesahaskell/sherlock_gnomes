import { forwardBackendJsonRequest } from "@/lib/backend-proxy";

export async function GET(request: Request) {
  const search = new URL(request.url).search;
  return forwardBackendJsonRequest(request, {
    backendPath: `/api/file${search}`,
    scope: "read",
  });
}
