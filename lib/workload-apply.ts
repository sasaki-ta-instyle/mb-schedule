import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { schema } from "@/db/client";

/**
 * タスク追加に伴って `workload.plannedHours` を加算 upsert するヘルパ。
 *
 * 同一 (memberId, weekIso) の合計を一度だけバケットに集約し、各バケットを
 * 1 回ずつ insert ... on conflict do update で加算する。
 *
 * 既存実装は `app/api/projects/route.ts`（POST = プロジェクト新規作成）に
 * インラインで書かれていたが、既存プロジェクトへのタスク追加でも同じロジック
 * を必要とするため切り出した。挙動は既存と完全一致させている：
 *   - assigneeMemberId が無い / estimatedHours が null / hours <= 0 は対象外
 *   - 既存行があれば plannedHours += hours、無ければ新規行を作成
 *
 * 呼び出し側は必ず Drizzle のトランザクション (`tx`) を渡すこと。tx に閉じる
 * ことで「tasks insert 成功 + workload upsert 失敗」のような半端な状態を防ぐ。
 */
type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];

export type WorkloadApplyInput = {
  assigneeMemberId: number | null;
  weekIso: string;
  estimatedHours: number | null;
};

export async function applyWorkloadIncrements(
  tx: Tx,
  tasks: ReadonlyArray<WorkloadApplyInput>,
): Promise<void> {
  const buckets = new Map<
    string,
    { memberId: number; weekIso: string; hours: number }
  >();
  for (const t of tasks) {
    if (!t.assigneeMemberId || t.estimatedHours == null) continue;
    if (t.estimatedHours <= 0) continue;
    const key = `${t.assigneeMemberId}::${t.weekIso}`;
    const cur = buckets.get(key);
    if (cur) cur.hours += t.estimatedHours;
    else
      buckets.set(key, {
        memberId: t.assigneeMemberId,
        weekIso: t.weekIso,
        hours: t.estimatedHours,
      });
  }

  // 並列リクエストが (memberId, weekIso) ペアを逆順で取りに行くとデッドロックが
  // 起き得るため、必ず一意な順序で upsert する。`/api/tasks/batch` も同じ慣例。
  const ordered = [...buckets.values()].sort(
    (a, b) =>
      a.memberId - b.memberId || a.weekIso.localeCompare(b.weekIso),
  );

  for (const b of ordered) {
    await tx
      .insert(schema.workload)
      .values({
        memberId: b.memberId,
        weekIso: b.weekIso,
        plannedHours: b.hours.toString(),
      })
      .onConflictDoUpdate({
        target: [schema.workload.memberId, schema.workload.weekIso],
        set: {
          plannedHours: sql`${schema.workload.plannedHours} + ${b.hours}`,
          updatedAt: sql`now()`,
        },
      });
  }
}
