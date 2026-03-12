import { forwardBackendJsonRequest } from "@/lib/backend-proxy";

export async function POST(request: Request) {
  return forwardBackendJsonRequest(request, {
    backendPath: "/api/git/repositories/import",
    scope: "admin",
    requireCsrf: true
  });
}
