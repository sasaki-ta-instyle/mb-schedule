import { db, schema } from "@/db/client";
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  clampHours,
  isValidWeekIso,
  sanitizeText,
  TEXT_LIMITS,
  toIntId,
} from "@/lib/validate";
import { getHiddenProjectIds, getViewerMemberId } from "@/lib/visibility";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const weekFrom = url.searchParams.get("weekFrom");
  const weekTo = url.searchParams.get("weekTo");
  const memberIds = url.searchParams.get("memberIds");

  const conds = [] as Array<
    ReturnType<typeof gte> | ReturnType<typeof lte> | ReturnType<typeof inArray>
  >;
  if (weekFrom && isValidWeekIso(weekFrom))
    conds.push(gte(schema.workload.weekIso, weekFrom));
  if (weekTo && isValidWeekIso(weekTo))
    conds.push(lte(schema.workload.weekIso, weekTo));
  if (memberIds) {
    const ids = memberIds.split(",").map(Number).filter(Number.isFinite);
    if (ids.length) conds.push(inArray(schema.workload.memberId, ids));
  }

  const rows = await db
    .select()
    .from(schema.workload)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(schema.workload.weekIso), asc(schema.workload.memberId));

  // H-2: 非公開プロジェクトの工数が workload 経由で漏れないよう、閲覧者から見えない
  // プロジェクトに属するタスク分を planned_hours から差し引いて返す。
  // 手動 PUT で乗っている分（タスク非依存）は対象外なので、減算後に 0 未満になったら 0 に丸める。
  const viewerId = await getViewerMemberId(req);
  const hiddenProjectIds = await getHiddenProjectIds(viewerId);
  if (hiddenProjectIds.length === 0) {
    return NextResponse.json(rows);
  }

  // 該当バケットの「非公開プロジェクト分の合計」を一括取得
  const taskConds = [
    inArray(schema.tasks.projectId, hiddenProjectIds),
    isNull(schema.projects.archivedAt),
  ] as const;
  const hiddenSums = await db
    .select({
      memberId: schema.tasks.assigneeMemberId,
      weekIso: schema.tasks.weekIso,
      total: sql<string>`COALESCE(SUM(${schema.tasks.estimatedHours})::numeric, 0)::text`,
    })
    .from(schema.tasks)
    .innerJoin(
      schema.projects,
      eq(schema.tasks.projectId, schema.projects.id),
    )
    .where(and(...taskConds))
    .groupBy(schema.tasks.assigneeMemberId, schema.tasks.weekIso);

  const subtractByKey = new Map<string, number>();
  for (const s of hiddenSums) {
    if (s.memberId == null) continue;
    const v = Number(s.total);
    if (!Number.isFinite(v) || v <= 0) continue;
    subtractByKey.set(`${s.memberId}::${s.weekIso}`, v);
  }

  const filtered = rows.map((r) => {
    const sub = subtractByKey.get(`${r.memberId}::${r.weekIso}`);
    if (!sub) return r;
    const current = Number(r.plannedHours);
    if (!Number.isFinite(current)) return r;
    const next = Math.max(0, current - sub);
    return { ...r, plannedHours: next.toFixed(2) };
  });
  return NextResponse.json(filtered);
}

export async function PUT(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const memberId = toIntId(body.memberId);
  const weekIso = body.weekIso;
  const hours = clampHours(body.plannedHours);
  if (!memberId) {
    return NextResponse.json(
      { error: "memberId must be a positive integer" },
      { status: 400 },
    );
  }
  if (!isValidWeekIso(weekIso)) {
    return NextResponse.json(
      { error: "weekIso must match YYYY-Www" },
      { status: 400 },
    );
  }
  if (hours == null) {
    return NextResponse.json(
      { error: "plannedHours must be a number in 0..200" },
      { status: 400 },
    );
  }
  const note =
    body.note === undefined || body.note === null
      ? null
      : sanitizeText(body.note, TEXT_LIMITS.workloadNote, { allowEmpty: true });

  const hoursStr = hours.toString();

  // H-3: 同じ (memberId, weekIso) バケットに対する手動 PUT が、タスク経由の差分加減 /
  // recompute と並行で走ったときの lost update を避けるため、まず行を確保して
  // FOR UPDATE で行ロックを取ってから UPSERT する。
  const row = await db.transaction(async (tx) => {
    await tx
      .insert(schema.workload)
      .values({ memberId, weekIso, plannedHours: "0", note: null })
      .onConflictDoNothing({
        target: [schema.workload.memberId, schema.workload.weekIso],
      });
    await tx
      .select({ id: schema.workload.id })
      .from(schema.workload)
      .where(
        and(
          eq(schema.workload.memberId, memberId),
          eq(schema.workload.weekIso, weekIso),
        ),
      )
      .for("update");
    const [updated] = await tx
      .update(schema.workload)
      .set({
        plannedHours: hoursStr,
        note,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schema.workload.memberId, memberId),
          eq(schema.workload.weekIso, weekIso),
        ),
      )
      .returning();
    return updated;
  });
  return NextResponse.json(row);
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const memberId = toIntId(url.searchParams.get("memberId"));
  const weekIso = url.searchParams.get("weekIso");
  if (!memberId) {
    return NextResponse.json(
      { error: "memberId must be a positive integer" },
      { status: 400 },
    );
  }
  if (!isValidWeekIso(weekIso)) {
    return NextResponse.json(
      { error: "weekIso must match YYYY-Www" },
      { status: 400 },
    );
  }
  await db
    .delete(schema.workload)
    .where(
      and(
        eq(schema.workload.memberId, memberId),
        eq(schema.workload.weekIso, weekIso),
      ),
    );
  return NextResponse.json({ ok: true });
}
