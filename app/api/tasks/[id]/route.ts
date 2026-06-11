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

type Bucket = {
  memberId: number;
  weekIso: string;
  hours: number;
};

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

function bucketKey(b: Bucket): string {
  return `${b.memberId.toString().padStart(10, "0")}::${b.weekIso}`;
}

async function adjustWorkload(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  add: Bucket | null,
  subtract: Bucket | null,
) {
  // 同じバケットなら差分計算で 1 行だけ更新
  if (
    add &&
    subtract &&
    add.memberId === subtract.memberId &&
    add.weekIso === subtract.weekIso
  ) {
    const delta = add.hours - subtract.hours;
    if (delta === 0) return;
    if (delta > 0) {
      await tx
        .insert(schema.workload)
        .values({
          memberId: add.memberId,
          weekIso: add.weekIso,
          plannedHours: delta.toString(),
        })
        .onConflictDoUpdate({
          target: [schema.workload.memberId, schema.workload.weekIso],
          set: {
            plannedHours: sql`${schema.workload.plannedHours} + ${delta}`,
            updatedAt: sql`now()`,
          },
        });
    } else {
      await tx
        .update(schema.workload)
        .set({
          plannedHours: sql`GREATEST(0, ${schema.workload.plannedHours}::numeric - ${Math.abs(delta)})`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.workload.memberId, add.memberId),
            eq(schema.workload.weekIso, add.weekIso),
          ),
        );
    }
    return;
  }

  // 異なるバケット2件: ロック順を (memberId, weekIso) 昇順で固定して
  // 逆方向 (A→B / B→A) 同時編集でのデッドロックを避ける
  const ops: Array<{ bucket: Bucket; kind: "add" | "sub" }> = [];
  if (subtract) ops.push({ bucket: subtract, kind: "sub" });
  if (add) ops.push({ bucket: add, kind: "add" });
  ops.sort((a, b) => bucketKey(a.bucket).localeCompare(bucketKey(b.bucket)));

  for (const op of ops) {
    const b = op.bucket;
    if (op.kind === "sub") {
      await tx
        .update(schema.workload)
        .set({
          plannedHours: sql`GREATEST(0, ${schema.workload.plannedHours}::numeric - ${b.hours})`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.workload.memberId, b.memberId),
            eq(schema.workload.weekIso, b.weekIso),
          ),
        );
    } else {
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
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const taskId = toIntId(id);
  if (!taskId) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };

  if ("title" in body) {
    const v = sanitizeText(body.title, TEXT_LIMITS.taskTitle);
    if (!v) {
      return NextResponse.json({ error: "invalid title" }, { status: 400 });
    }
    update.title = v;
  }
  if ("weekIso" in body) {
    if (!isValidWeekIso(body.weekIso)) {
      return NextResponse.json({ error: "invalid weekIso" }, { status: 400 });
    }
    update.weekIso = body.weekIso;
  }
  if ("assigneeMemberId" in body) {
    if (body.assigneeMemberId === null) {
      update.assigneeMemberId = null;
    } else {
      const v = toIntId(body.assigneeMemberId);
      if (!v) {
        return NextResponse.json(
          { error: "invalid assigneeMemberId" },
          { status: 400 },
        );
      }
      update.assigneeMemberId = v;
    }
  }
  if ("done" in body) {
    if (typeof body.done !== "boolean") {
      return NextResponse.json(
        { error: "done must be boolean" },
        { status: 400 },
      );
    }
    update.done = body.done;
  }
  if ("notes" in body) {
    if (body.notes === null) {
      update.notes = null;
    } else {
      const v = sanitizeText(body.notes, TEXT_LIMITS.taskNotes, {
        allowEmpty: true,
      });
      update.notes = v;
    }
  }
  if ("estimatedHours" in body) {
    if (body.estimatedHours === null) {
      update.estimatedHours = null;
    } else {
      const v = clampHours(body.estimatedHours);
      if (v == null) {
        return NextResponse.json(
          { error: "invalid estimatedHours" },
          { status: 400 },
        );
      }
      update.estimatedHours = v.toString();
    }
  }
  if ("sortOrder" in body) {
    if (
      typeof body.sortOrder === "number" &&
      Number.isInteger(body.sortOrder)
    ) {
      update.sortOrder = body.sortOrder;
    }
  }
  if ("projectId" in body) {
    const v = toIntId(body.projectId);
    if (!v) {
      return NextResponse.json({ error: "invalid projectId" }, { status: 400 });
    }
    update.projectId = v;
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json(
      { error: "no updatable fields" },
      { status: 400 },
    );
  }

  // workload 影響フィールドが変わったときだけトランザクション + 差分調整
  const affectsWorkload =
    "estimatedHours" in body ||
    "assigneeMemberId" in body ||
    "weekIso" in body;

  try {
    const row = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, taskId))
        .for("update")
        .limit(1);
      if (!current) throw new Error("TASK_NOT_FOUND");

      const oldBucket = contributionOf(
        current.assigneeMemberId,
        current.weekIso,
        current.estimatedHours == null ? null : Number(current.estimatedHours),
      );

      const newAssignee =
        "assigneeMemberId" in update
          ? (update.assigneeMemberId as number | null)
          : current.assigneeMemberId;
      const newWeek =
        "weekIso" in update
          ? (update.weekIso as string)
          : current.weekIso;
      const newHoursStr =
        "estimatedHours" in update
          ? (update.estimatedHours as string | null)
          : current.estimatedHours;
      const newHours = newHoursStr == null ? null : Number(newHoursStr);
      const newBucket = contributionOf(newAssignee, newWeek, newHours);

      if (affectsWorkload) {
        await adjustWorkload(tx, newBucket, oldBucket);
      }

      const [updated] = await tx
        .update(schema.tasks)
        .set(update)
        .where(eq(schema.tasks.id, taskId))
        .returning();
      return updated;
    });
    return NextResponse.json(row);
  } catch (e) {
    if ((e as Error).message === "TASK_NOT_FOUND") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw e;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const taskId = toIntId(id);
  if (!taskId) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, taskId))
        .for("update")
        .limit(1);
      if (!current) throw new Error("TASK_NOT_FOUND");
      const bucket = contributionOf(
        current.assigneeMemberId,
        current.weekIso,
        current.estimatedHours == null ? null : Number(current.estimatedHours),
      );
      if (bucket) {
        await adjustWorkload(tx, null, bucket);
      }
      await tx.delete(schema.tasks).where(eq(schema.tasks.id, taskId));
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if ((e as Error).message === "TASK_NOT_FOUND") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw e;
  }
}
