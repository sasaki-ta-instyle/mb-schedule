import { db, schema } from "@/db/client";
import { isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * すべての workload 行を、アクティブな（archivedAt が NULL の）プロジェクトの
 * タスク estimatedHours 合計で再計算する。
 * - 既存タスクのある (memberId, weekIso) は SUM(estimatedHours)
 * - 既存タスクのない workload 行は 0
 *
 * 「プロジェクトを全部消したのに工数が残っている」のような
 * 過去のドリフトを揃えるためのリセット用エンドポイント。
 */
export async function POST() {
  const result = await db.transaction(async (tx) => {
    // 1) 既存 workload を 0 にリセット
    const zeroed = await tx
      .update(schema.workload)
      .set({ plannedHours: "0", updatedAt: sql`now()` })
      .returning({ id: schema.workload.id });

    // 2) アクティブタスクから (memberId, weekIso, sum) を集計
    const aggregated = await tx
      .select({
        memberId: schema.tasks.assigneeMemberId,
        weekIso: schema.tasks.weekIso,
        total: sql<string>`SUM(${schema.tasks.estimatedHours})::text`,
      })
      .from(schema.tasks)
      .innerJoin(
        schema.projects,
        sql`${schema.tasks.projectId} = ${schema.projects.id}`,
      )
      .where(isNull(schema.projects.archivedAt))
      .groupBy(schema.tasks.assigneeMemberId, schema.tasks.weekIso);

    let upserted = 0;
    for (const row of aggregated) {
      if (row.memberId == null || row.weekIso == null) continue;
      const total = Number(row.total ?? "0");
      if (!Number.isFinite(total) || total <= 0) continue;
      await tx
        .insert(schema.workload)
        .values({
          memberId: row.memberId,
          weekIso: row.weekIso,
          plannedHours: total.toString(),
        })
        .onConflictDoUpdate({
          target: [schema.workload.memberId, schema.workload.weekIso],
          set: {
            plannedHours: total.toString(),
            updatedAt: sql`now()`,
          },
        });
      upserted += 1;
    }

    return { zeroedRows: zeroed.length, upsertedBuckets: upserted };
  });

  return NextResponse.json({ ok: true, ...result });
}
