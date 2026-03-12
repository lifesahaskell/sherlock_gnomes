import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { validateOrigin } from "@/lib/csrf";
import { getSessionOptions, type SessionData } from "@/lib/session";

export async function POST(request: Request): Promise<NextResponse> {
  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }

  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());
  session.destroy();

  return NextResponse.json({ success: true }, {
    headers: { "Cache-Control": "no-store" },
  });
}
