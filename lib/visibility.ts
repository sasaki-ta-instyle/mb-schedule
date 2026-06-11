import { db, schema } from "@/db/client";
import { eq, or, sql } from "drizzle-orm";
import { COOKIE_NAME, getSessionMemberId, readCookie } from "@/lib/auth";

export async function getViewerMemberId(req: Request): Promise<number | null> {
  const sid = readCookie(req, COOKIE_NAME);
  if (!sid) return null;
  return getSessionMemberId(sid);
}

/**
 * 「閲覧者から見える」プロジェクトの条件。
 * - 非公開でない (is_private = false) なら全員に見える
 * - 非公開でも、ログイン中メンバーが plannedMemberIds に含まれていれば見える
 */
export function visibilityCondition(memberId: number | null) {
  if (memberId == null) {
    return eq(schema.projects.isPrivate, false);
  }
  const me = JSON.stringify([memberId]);
  return or(
    eq(schema.projects.isPrivate, false),
    sql`${schema.projects.plannedMemberIds} @> ${me}::jsonb`,
    sql`${schema.projects.visibleMemberIds} @> ${me}::jsonb`,
  )!;
}

export async function getVisibleProjectIds(memberId: number | null): Promise<number[]> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(visibilityCondition(memberId));
  return rows.map((r) => r.id);
}

/**
 * 「閲覧者から見えない（非公開かつ自分が plannedMemberIds/visibleMemberIds に居ない）」
 * プロジェクト ID を返す。`workload` の集計値から、非公開プロジェクトのタスク分を差し引くために使う。
 */
export async function getHiddenProjectIds(memberId: number | null): Promise<number[]> {
  const allRows = await db.select({ id: schema.projects.id }).from(schema.projects);
  const visible = new Set(await getVisibleProjectIds(memberId));
  return allRows.map((r) => r.id).filter((id) => !visible.has(id));
}
