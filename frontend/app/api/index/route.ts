import { forwardBackendJsonRequest } from "@/lib/backend-proxy";

export async function POST(request: Request) {
  return forwardBackendJsonRequest(request, {
    backendPath: "/api/index",
    scope: "admin",
    requireCsrf: true,
  });
}
