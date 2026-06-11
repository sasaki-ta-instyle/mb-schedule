import { NextResponse } from "next/server";
import {
  clearMemberPassword,
  COOKIE_NAME,
  getSessionMemberId,
  isMemberAdmin,
  readCookie,
  setMemberPassword,
} from "@/lib/auth";
import { toIntId } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_LEN = 4;
const MAX_LEN = 128;

async function requireAdmin(req: Request): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const sid = readCookie(req, COOKIE_NAME);
  if (!sid) return { ok: false, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const memberId = await getSessionMemberId(sid);
  if (!memberId) return { ok: false, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const admin = await isMemberAdmin(memberId);
  if (!admin) return { ok: false, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { ok: true };
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const targetId = toIntId(id);
  if (!targetId) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: { newPassword?: unknown } = {};
  try {
    body = await req.json();
  } catch {}
  if (
    typeof body.newPassword !== "string" ||
    body.newPassword.length < MIN_LEN ||
    body.newPassword.length > MAX_LEN ||
    body.newPassword.trim() !== body.newPassword
  ) {
    return NextResponse.json(
      { error: `newPassword must be ${MIN_LEN}..${MAX_LEN} chars (no leading/trailing spaces)` },
      { status: 400 },
    );
  }

  await setMemberPassword(targetId, body.newPassword);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const targetId = toIntId(id);
  if (!targetId) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await clearMemberPassword(targetId);
  return NextResponse.json({ ok: true });
}
