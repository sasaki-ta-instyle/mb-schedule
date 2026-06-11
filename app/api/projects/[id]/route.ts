import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  isPositiveIntArray,
  isValidIsoDate,
  isValidProjectStatus,
  sanitizeText,
  TEXT_LIMITS,
  toIntId,
} from "@/lib/validate";
import { isKnownCompany } from "@/lib/companies";
import {
  collectWorkloadBuckets,
  recomputeWorkloadBuckets,
} from "@/lib/project-workload";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = toIntId(id);
  if (!projectId) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const update: Record<string, unknown> = {};

  if ("name" in body) {
    const v = sanitizeText(body.name, TEXT_LIMITS.projectName);
    if (!v) {
      return NextResponse.json({ error: "invalid name" }, { status: 400 });
    }
    update.name = v;
  }
  if ("summary" in body) {
    const v = sanitizeText(body.summary, TEXT_LIMITS.projectSummary, {
      allowEmpty: true,
    });
    update.summary = v ?? "";
  }
  if ("notes" in body) {
    const v = sanitizeText(body.notes, TEXT_LIMITS.projectNotes, {
      allowEmpty: true,
    });
    update.notes = v ?? "";
  }
  if ("dueDate" in body) {
    if (body.dueDate === null) {
      update.dueDate = null;
    } else if (isValidIsoDate(body.dueDate)) {
      update.dueDate = body.dueDate;
    } else {
      return NextResponse.json(
        { error: "dueDate must be a valid YYYY-MM-DD date or null" },
        { status: 400 },
      );
    }
  }
  if ("company" in body) {
    if (body.company === null || body.company === "") {
      update.company = null;
    } else if (isKnownCompany(body.company)) {
      update.company = body.company;
    } else {
      return NextResponse.json({ error: "invalid company" }, { status: 400 });
    }
  }
  if ("status" in body) {
    if (!isValidProjectStatus(body.status)) {
      return NextResponse.json(
        { error: "invalid status" },
        { status: 400 },
      );
    }
    update.status = body.status;
  }
  if ("plannedMemberIds" in body) {
    if (!isPositiveIntArray(body.plannedMemberIds)) {
      return NextResponse.json(
        { error: "plannedMemberIds must be number[]" },
        { status: 400 },
      );
    }
    const ids = body.plannedMemberIds as number[];
    update.plannedMemberIds = ids;
    if (ids.length > 0) {
      const [primary] = await db
        .select({ color: schema.members.color })
        .from(schema.members)
        .where(eq(schema.members.id, ids[0]))
        .limit(1);
      if (primary?.color) update.color = primary.color;
    }
  }
  if ("visibleMemberIds" in body) {
    if (!isPositiveIntArray(body.visibleMemberIds)) {
      return NextResponse.json(
        { error: "visibleMemberIds must be number[]" },
        { status: 400 },
      );
    }
    update.visibleMemberIds = body.visibleMemberIds;
  }
  if ("isPrivate" in body) {
    if (typeof body.isPrivate !== "boolean") {
      return NextResponse.json(
        { error: "isPrivate must be boolean" },
        { status: 400 },
      );
    }
    update.isPrivate = body.isPrivate;
  }
  if ("sortOrder" in body) {
    if (
      typeof body.sortOrder === "number" &&
      Number.isInteger(body.sortOrder)
    ) {
      update.sortOrder = body.sortOrder;
    } else {
      return NextResponse.json(
        { error: "sortOrder must be integer" },
        { status: 400 },
      );
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no updatable fields" }, { status: 400 });
  }

  const [row] = await db
    .update(schema.projects)
    .set(update)
    .where(eq(schema.projects.id, projectId))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = toIntId(id);
  if (!projectId) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      // 1) プロジェクトの存在確認 & archived 状態取得
      const [exists] = await tx
        .select({
          id: schema.projects.id,
          archivedAt: schema.projects.archivedAt,
        })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
      if (!exists) {
        throw new Error("PROJECT_NOT_FOUND");
      }

      // 影響を受けるバケットを先に把握（タスク削除前に）
      const buckets = await collectWorkloadBuckets(tx, projectId);

      // タスクは projects.id への FK (onDelete: cascade) で連動削除されるが、
      // 件数を返すために明示的に削除する
      const deletedTasks = await tx
        .delete(schema.tasks)
        .where(eq(schema.tasks.projectId, projectId))
        .returning({ id: schema.tasks.id });

      // プロジェクト行を物理削除
      await tx
        .delete(schema.projects)
        .where(eq(schema.projects.id, projectId));

      // 残りのアクティブタスクから対象バケットを再計算
      await recomputeWorkloadBuckets(tx, buckets);

      return {
        deletedTaskCount: deletedTasks.length,
        adjustedWorkloadBuckets: buckets.size,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if ((e as Error).message === "PROJECT_NOT_FOUND") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw e;
  }
}

