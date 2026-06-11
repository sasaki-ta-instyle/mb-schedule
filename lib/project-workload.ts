import { db, schema } from "@/db/client";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type WorkloadBucket = {
  memberId: number;
  weekIso: string;
  hours: number;
};

/**
 * 指定された (memberId, weekIso) バケットの workload を、
 * アクティブな（archivedAt が NULL の）プロジェクトに属するタスクの
 * estimatedHours 合計で**上書き**する。
 *
 * これにより、プロジェクトをアーカイブ／削除した結果として
 * 「残り 0h」のバケットが発生したときに workload が必ず 0 に揃う。
 *
 * 注: 手動で workload を編集していた場合、対象バケットの値はクロッバーされる。
 * 「プロジェクトを消したのに工数が 0 にならない」という直感に合わせるためのトレードオフ。
 *
 * 実装メモ (M-3): 旧実装はバケット数だけ SELECT + UPSERT を直列実行していた。
 * 影響バケットが数十〜数百になるプロジェクト削除時にトランザクションが長く開いていたため、
 * GROUP BY での一括集計 + INSERT ... ON CONFLICT で 2 クエリにまとめている。
 */
export async function recomputeWorkloadBuckets(
  tx: Tx,
  buckets: Map<string, WorkloadBucket>,
) {
  if (buckets.size === 0) return;

  const targetKeys = [...buckets.values()];
  const memberIds = Array.from(new Set(targetKeys.map((b) => b.memberId)));
  const weekIsos = Array.from(new Set(targetKeys.map((b) => b.weekIso)));

  // 該当 (memberId, weekIso) 組のうち、アクティブプロジェクトのタスク合計を一括集計
  const aggRows = await tx
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
    .where(
      and(
        inArray(schema.tasks.assigneeMemberId, memberIds),
        inArray(schema.tasks.weekIso, weekIsos),
        isNull(schema.projects.archivedAt),
      ),
    )
    .groupBy(schema.tasks.assigneeMemberId, schema.tasks.weekIso);

  const aggByKey = new Map<string, string>();
  for (const r of aggRows) {
    if (r.memberId == null) continue;
    aggByKey.set(`${r.memberId}::${r.weekIso}`, r.total);
  }

  const valuesToWrite = targetKeys.map((b) => ({
    memberId: b.memberId,
    weekIso: b.weekIso,
    plannedHours: aggByKey.get(`${b.memberId}::${b.weekIso}`) ?? "0",
  }));

  await tx
    .insert(schema.workload)
    .values(valuesToWrite)
    .onConflictDoUpdate({
      target: [schema.workload.memberId, schema.workload.weekIso],
      set: {
        plannedHours: sql`EXCLUDED.planned_hours`,
        updatedAt: sql`now()`,
      },
    });

  // 参考: or(...) を使うと将来 inArray 組合せ外のバケットも対象にしたくなったとき拡張しやすい。
  // 現状は inArray × 2 で十分カバーできているので未使用。
  void or;
}

export async function collectWorkloadBuckets(
  tx: Tx,
  projectId: number,
): Promise<Map<string, WorkloadBucket>> {
  const taskRows = await tx
    .select({
      assigneeMemberId: schema.tasks.assigneeMemberId,
      weekIso: schema.tasks.weekIso,
      estimatedHours: schema.tasks.estimatedHours,
    })
    .from(schema.tasks)
    .where(eq(schema.tasks.projectId, projectId));

  const buckets = new Map<string, WorkloadBucket>();
  for (const t of taskRows) {
    if (!t.assigneeMemberId || !t.weekIso || t.estimatedHours == null) continue;
    const h = Number(t.estimatedHours);
    if (!Number.isFinite(h) || h <= 0) continue;
    const key = `${t.assigneeMemberId}::${t.weekIso}`;
    const cur = buckets.get(key);
    if (cur) cur.hours += h;
    else
      buckets.set(key, {
        memberId: t.assigneeMemberId,
        weekIso: t.weekIso,
        hours: h,
      });
  }
  return buckets;
}
