import { NextResponse } from "next/server";
import {
  authCookieHeader,
  authenticateMember,
  COOKIE_NAME,
  createSession,
  deleteSession,
  encodeSessionLabel,
  getSessionMemberId,
  isAuthorizedAsync,
  MAX_AGE_SEC,
  readCookie,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const ok = await isAuthorizedAsync(req);
  let memberId: number | null = null;
  if (ok) {
    const sid = readCookie(req, COOKIE_NAME);
    if (sid) memberId = await getSessionMemberId(sid);
  }
  return NextResponse.json(
    { ok, authEnabled: true, memberId },
    { status: ok ? 200 : 401 },
  );
}

export async function POST(req: Request) {
  let body: { password?: unknown; memberId?: unknown } = {};
  try {
    body = await req.json();
  } catch {}

  const memberId =
    typeof body.memberId === "number" && Number.isInteger(body.memberId) && body.memberId > 0
      ? body.memberId
      : null;
  if (memberId == null) {
    return NextResponse.json({ error: "memberId required" }, { status: 400 });
  }

  const result = await authenticateMember(memberId, body.password);
  if (!result.ok) {
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }

  const ua = req.headers.get("user-agent");
  const sessionId = await createSession(encodeSessionLabel(memberId, ua));
  return new NextResponse(
    JSON.stringify({
      ok: true,
      memberId,
      usedAdmin: result.usedAdmin,
      hasPersonalPassword: result.hasPersonalPassword,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": authCookieHeader(sessionId, MAX_AGE_SEC),
      },
    },
  );
}

export async function DELETE(req: Request) {
  const sid = readCookie(req, COOKIE_NAME);
  if (sid) {
    try {
      await deleteSession(sid);
    } catch {}
  }
  return new NextResponse(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": authCookieHeader("", 0),
    },
  });
}
