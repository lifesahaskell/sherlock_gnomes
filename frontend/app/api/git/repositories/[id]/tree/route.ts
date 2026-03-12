import { forwardBackendJsonRequest } from "@/lib/backend-proxy";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const search = new URL(request.url).search;
  return forwardBackendJsonRequest(request, {
    backendPath: `/api/git/repositories/${id}/tree${search}`,
    scope: "read"
  });
}
