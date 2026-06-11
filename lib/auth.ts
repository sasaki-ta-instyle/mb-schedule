import crypto from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db/client";

const COOKIE = "ig_edit";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30日

function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? "1111";
}

// 認証は常に有効（admin パスワードがあれば常に通る）
export function isAuthEnabled(): boolean {
  return true;
}

function constantTimeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function isAdminPassword(plain: unknown): boolean {
  if (typeof plain !== "string") return false;
  return constantTimeEqualString(plain, getAdminPassword());
}

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyHash(plain: unknown, stored: string | null | undefined): boolean {
  if (typeof plain !== "string" || !stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], "base64url");
    expected = Buffer.from(parts[2], "base64url");
  } catch {
    return false;
  }
  let got: Buffer;
  try {
    got = crypto.scryptSync(plain, salt, expected.length);
  } catch {
    return false;
  }
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(got, expected);
}

/**
 * メンバー個別パスワード or admin パスワードを検証。
 * - 個別パスワードが設定されていればそれと一致 → OK
 * - admin パスワードと一致 → OK
 * - それ以外 → NG
 */
export async function authenticateMember(
  memberId: number,
  plain: unknown,
): Promise<{ ok: boolean; usedAdmin: boolean; hasPersonalPassword: boolean }> {
  const [m] = await db
    .select({ id: schema.members.id, passwordHash: schema.members.passwordHash })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  if (!m) return { ok: false, usedAdmin: false, hasPersonalPassword: false };
  const hasPersonal = Boolean(m.passwordHash);
  if (hasPersonal && verifyHash(plain, m.passwordHash)) {
    return { ok: true, usedAdmin: false, hasPersonalPassword: true };
  }
  if (isAdminPassword(plain)) {
    return { ok: true, usedAdmin: true, hasPersonalPassword: hasPersonal };
  }
  return { ok: false, usedAdmin: false, hasPersonalPassword: hasPersonal };
}

export async function setMemberPassword(memberId: number, newPlain: string) {
  const hash = hashPassword(newPlain);
  await db
    .update(schema.members)
    .set({ passwordHash: hash })
    .where(eq(schema.members.id, memberId));
}

export async function clearMemberPassword(memberId: number) {
  await db
    .update(schema.members)
    .set({ passwordHash: null })
    .where(eq(schema.members.id, memberId));
}

export async function isMemberAdmin(memberId: number): Promise<boolean> {
  const [m] = await db
    .select({ isAdmin: schema.members.isAdmin })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  return Boolean(m?.isAdmin);
}

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function newSessionId(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function createSession(label?: string | null): Promise<string> {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + MAX_AGE_SEC * 1000);
  await db.insert(schema.sessions).values({
    id,
    expiresAt,
    label: label ?? null,
  });
  return id;
}

export function encodeSessionLabel(memberId: number | null, ua: string | null): string {
  return JSON.stringify({ m: memberId, ua: (ua ?? "").slice(0, 120) });
}

export function decodeSessionLabel(label: string | null): {
  memberId: number | null;
  ua: string | null;
} {
  if (!label) return { memberId: null, ua: null };
  try {
    const o = JSON.parse(label) as { m?: unknown; ua?: unknown };
    const memberId =
      typeof o.m === "number" && Number.isInteger(o.m) && o.m > 0 ? o.m : null;
    const ua = typeof o.ua === "string" ? o.ua : null;
    return { memberId, ua };
  } catch {
    return { memberId: null, ua: label };
  }
}

export async function getSessionMemberId(id: string): Promise<number | null> {
  if (!id) return null;
  const [row] = await db
    .select({ label: schema.sessions.label, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return decodeSessionLabel(row.label).memberId;
}

export async function deleteSession(id: string): Promise<void> {
  if (!id) return;
  await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
}

export async function touchSessionIfValid(id: string): Promise<boolean> {
  if (!id) return false;
  // 期限内のセッションだけ有効
  const [row] = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.id, id),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return false;
  // last_seen を更新（ベストエフォート）
  try {
    await db
      .update(schema.sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.sessions.id, id));
  } catch {}
  return true;
}

export async function isAuthorizedAsync(req: Request): Promise<boolean> {
  if (!isAuthEnabled()) return true;
  const sid = readCookie(req, COOKIE);
  if (!sid) return false;
  return touchSessionIfValid(sid);
}

export function authCookieHeader(value: string, maxAgeSec: number): string {
  const parts = [
    `${COOKIE}=${encodeURIComponent(value)}`,
    `Path=/`,
    `Max-Age=${maxAgeSec}`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export { COOKIE as COOKIE_NAME, MAX_AGE_SEC };
