import { NextResponse } from "next/server";
import {
  authenticateMember,
  COOKIE_NAME,
  getSessionMemberId,
  readCookie,
  setMemberPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_LEN = 4;
const MAX_LEN = 128;

export async function POST(req: Request) {
  const sid = readCookie(req, COOKIE_NAME);
  if (!sid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const memberId = await getSessionMemberId(sid);
  if (!memberId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { currentPassword?: unknown; newPassword?: unknown } = {};
  try {
    body = await req.json();
  } catch {}

  if (
    typeof body.newPassword !== "string" ||
    body.newPassword.length < MIN_LEN ||
    body.newPassword.length > MAX_LEN
  ) {
    return NextResponse.json(
      { error: `newPassword must be ${MIN_LEN}..${MAX_LEN} chars` },
      { status: 400 },
    );
  }
  if (body.newPassword.trim() !== body.newPassword) {
    return NextResponse.json(
      { error: "newPassword must not have leading/trailing spaces" },
      { status: 400 },
    );
  }

  const result = await authenticateMember(memberId, body.currentPassword);
  if (!result.ok) {
    return NextResponse.json(
      { error: "current password is wrong" },
      { status: 401 },
    );
  }

  await setMemberPassword(memberId, body.newPassword);
  return NextResponse.json({ ok: true });
}
