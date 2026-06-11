import { db, schema } from "@/db/client";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  clampHours,
  isValidWeekIso,
  sanitizeText,
  TEXT_LIMITS,
  toIntId,
} from "@/lib/validate";

export const dynamic = "force-dynamic";

type Bucket = { memberId: number; weekIso: string; hours: number };

function contributionOf(
  assigneeMemberId: number | null,
  weekIso: string | null,
  estimatedHours: number | null,
): Bucket | null {
  if (
    !assigneeMemberId ||
    !weekIso ||
    !estimatedHours ||
    !Number.isFinite(estimatedHours) ||
    estimatedHours <= 0
  ) {
    return null;
  }
  return { memberId: assigneeMemberId, weekIso, hours: estimatedHours };
}

type IncomingPatch = {
  id: unknown;
  patch: Record<string, unknown>;
};

export async function POST(req: Request) {
  let body: { ops?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!Array.isArray(body.ops)) {
    return NextResponse.json(
      { error: "ops must be an array" },
      { status: 400 },
    );
  }
  const MAX_OPS = 100;
  if (body.ops.length === 0 || body.ops.length > MAX_OPS) {
    return NextResponse.json(
      { error: `ops length must be 1..${MAX_OPS}` },
      { status: 400 },
    );
  }

  // 1) パッチを検証してから lock 順序の決定的なキーで sort
  type Validated = {
    id: number;
    update: Record<string, unknown>;
    body: Record<string, unknown>;
  };
  const validated: Validated[] = [];
  for (const raw of body.ops as IncomingPatch[]) {
    if (!raw || typeof raw !== "object")
      return NextResponse.json({ error: "invalid op" }, { status: 400 });
    const id = toIntId(raw.id);
    if (!id) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const patch = raw.patch ?? {};
    if (typeof patch !== "object" || patch === null) {
      return NextResponse.json({ error: "invalid patch" }, { status: 400 });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if ("title" in patch) {
      const v = sanitizeText(patch.title, TEXT_LIMITS.taskTitle);
      if (!v) return NextResponse.json({ error: "invalid title" }, { status: 400 });
      update.title = v;
    }
    if ("weekIso" in patch) {
      if (!isValidWeekIso(patch.weekIso))
        return NextResponse.json({ error: "invalid weekIso" }, { status: 400 });
      update.weekIso = patch.weekIso;
    }
    if ("assigneeMemberId" in patch) {
      if (patch.assigneeMemberId === null) update.assigneeMemberId = null;
      else {
        const v = toIntId(patch.assigneeMemberId);
        if (!v)
          return NextResponse.json(
            { error: "invalid assigneeMemberId" },
            { status: 400 },
          );
        update.assigneeMemberId = v;
      }
    }
    if ("done" in patch) {
      if (typeof patch.done !== "boolean")
        return NextResponse.json({ error: "done must be boolean" }, { status: 400 });
      update.done = patch.done;
    }
    if ("notes" in patch) {
      if (patch.notes === null) update.notes = null;
      else
        update.notes = sanitizeText(patch.notes, TEXT_LIMITS.taskNotes, {
          allowEmpty: true,
        });
    }
    if ("estimatedHours" in patch) {
      if (patch.estimatedHours === null) update.estimatedHours = null;
      else {
        const v = clampHours(patch.estimatedHours);
        if (v == null)
          return NextResponse.json(
            { error: "invalid estimatedHours" },
            { status: 400 },
          );
        update.estimatedHours = v.toString();
      }
    }
    if ("sortOrder" in patch) {
      if (
        typeof patch.sortOrder === "number" &&
        Number.isInteger(patch.sortOrder)
      ) {
        update.sortOrder = patch.sortOrder;
      } else {
        return NextResponse.json(
          { error: "sortOrder must be integer" },
          { status: 400 },
        );
      }
    }
    if (Object.keys(update).length === 1) {
      return NextResponse.json(
        { error: `op for id=${id} has no updatable fields` },
        { status: 400 },
      );
    }
    validated.push({ id, update, body: patch as Record<string, unknown> });
  }

  // 2) lock order を id 昇順に固定（同タスクの重複もまとめる）
  validated.sort((a, b) => a.id - b.id);

  const result = await db.transaction(async (tx) => {
    type WorkloadDelta = { memberId: number; weekIso: string; delta: number };
    const deltas: WorkloadDelta[] = [];

    const updatedRows: Array<{ id: number }> = [];

    for (const v of validated) {
      const [current] = await tx
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, v.id))
        .for("update")
        .limit(1);
      if (!current) continue; // 既に消えている場合はスキップ

      const oldBucket = contributionOf(
        current.assigneeMemberId,
        current.weekIso,
        current.estimatedHours == null ? null : Number(current.estimatedHours),
      );

      const newAssignee =
        "assigneeMemberId" in v.update
          ? (v.update.assigneeMemberId as number | null)
          : current.assigneeMemberId;
      const newWeek =
        "weekIso" in v.update
          ? (v.update.weekIso as string)
          : current.weekIso;
      const newHoursStr =
        "estimatedHours" in v.update
          ? (v.update.estimatedHours as string | null)
          : current.estimatedHours;
      const newHours = newHoursStr == null ? null : Number(newHoursStr);
      const newBucket = contributionOf(newAssignee, newWeek, newHours);

      const affectsWorkload =
        "estimatedHours" in v.update ||
        "assigneeMemberId" in v.update ||
        "weekIso" in v.update;

      if (affectsWorkload) {
        if (oldBucket)
          deltas.push({
            memberId: oldBucket.memberId,
            weekIso: oldBucket.weekIso,
            delta: -oldBucket.hours,
          });
        if (newBucket)
          deltas.push({
            memberId: newBucket.memberId,
            weekIso: newBucket.weekIso,
            delta: newBucket.hours,
          });
      }

      const [updated] = await tx
        .update(schema.tasks)
        .set(v.update)
        .where(eq(schema.tasks.id, v.id))
        .returning({ id: schema.tasks.id });
      if (updated) updatedRows.push(updated);
    }

    // 3) workload の更新を (memberId, weekIso) ごとに集約して
    //    決定的なキー順で適用 → デッドロック回避
    const bucketMap = new Map<string, WorkloadDelta>();
    for (const d of deltas) {
      const key = `${d.memberId}::${d.weekIso}`;
      const cur = bucketMap.get(key);
      if (cur) cur.delta += d.delta;
      else bucketMap.set(key, { ...d });
    }
    const sortedKeys = [...bucketMap.keys()].sort();
    for (const k of sortedKeys) {
      const d = bucketMap.get(k)!;
      if (d.delta === 0) continue;
      if (d.delta > 0) {
        await tx
          .insert(schema.workload)
          .values({
            memberId: d.memberId,
            weekIso: d.weekIso,
            plannedHours: d.delta.toString(),
          })
          .onConflictDoUpdate({
            target: [schema.workload.memberId, schema.workload.weekIso],
            set: {
              plannedHours: sql`${schema.workload.plannedHours} + ${d.delta}`,
              updatedAt: sql`now()`,
            },
          });
      } else {
        await tx
          .update(schema.workload)
          .set({
            plannedHours: sql`GREATEST(0, ${schema.workload.plannedHours}::numeric - ${Math.abs(d.delta)})`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.workload.memberId, d.memberId),
              eq(schema.workload.weekIso, d.weekIso),
            ),
          );
      }
    }

    return { updated: updatedRows.length };
  });

  return NextResponse.json({ ok: true, ...result });
}
