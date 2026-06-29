import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  clampHours,
  clampWeekOfMonth,
  sanitizeText,
  TEXT_LIMITS,
  toIntId,
} from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_RECURRENCE = new Set<string>(["weekly", "monthly"]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rid = toIntId(id);
  if (!rid) {
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
  if ("recurrenceType" in body) {
    if (
      typeof body.recurrenceType !== "string" ||
      !ALLOWED_RECURRENCE.has(body.recurrenceType)
    ) {
      return NextResponse.json(
        { error: "invalid recurrenceType" },
        { status: 400 },
      );
    }
    update.recurrenceType = body.recurrenceType;
    // weekly に切り替えるなら weekOfMonth は意味を持たないので null に落とす
    if (body.recurrenceType === "weekly") {
      update.weekOfMonth = null;
    }
  }
  if ("weekOfMonth" in body) {
    if (body.weekOfMonth === null) {
      update.weekOfMonth = null;
    } else {
      const v = clampWeekOfMonth(body.weekOfMonth);
      if (v == null) {
        return NextResponse.json(
          { error: "invalid weekOfMonth (must be 1..5)" },
          { status: 400 },
        );
      }
      update.weekOfMonth = v;
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
  if ("sortOrder" in body) {
    if (
      typeof body.sortOrder === "number" &&
      Number.isInteger(body.sortOrder)
    ) {
      update.sortOrder = body.sortOrder;
    }
  }
  if ("archivedAt" in body) {
    if (body.archivedAt === null) {
      update.archivedAt = null;
    } else if (typeof body.archivedAt === "string") {
      const d = new Date(body.archivedAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "invalid archivedAt" },
          { status: 400 },
        );
      }
      update.archivedAt = d;
    } else if (body.archivedAt === true) {
      update.archivedAt = new Date();
    } else if (body.archivedAt === false) {
      update.archivedAt = null;
    } else {
      return NextResponse.json(
        { error: "invalid archivedAt" },
        { status: 400 },
      );
    }
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json(
      { error: "no updatable fields" },
      { status: 400 },
    );
  }

  const [row] = await db
    .update(schema.recurringTasks)
    .set(update)
    .where(eq(schema.recurringTasks.id, rid))
    .returning();
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(row);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rid = toIntId(id);
  if (!rid) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const [row] = await db
    .delete(schema.recurringTasks)
    .where(eq(schema.recurringTasks.id, rid))
    .returning({ id: schema.recurringTasks.id });
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
