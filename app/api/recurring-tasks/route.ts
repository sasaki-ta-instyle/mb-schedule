import { db, schema } from "@/db/client";
import { and, asc, isNull } from "drizzle-orm";
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("archived") === "1";
  const rows = await db
    .select()
    .from(schema.recurringTasks)
    .where(includeArchived ? undefined : isNull(schema.recurringTasks.archivedAt))
    .orderBy(
      asc(schema.recurringTasks.sortOrder),
      asc(schema.recurringTasks.id),
    );
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const title = sanitizeText(body.title, TEXT_LIMITS.taskTitle);
  if (!title) {
    return NextResponse.json(
      { error: `title must be 1..${TEXT_LIMITS.taskTitle} chars` },
      { status: 400 },
    );
  }
  const assigneeMemberId =
    body.assigneeMemberId == null ? null : toIntId(body.assigneeMemberId);
  if (body.assigneeMemberId != null && assigneeMemberId == null) {
    return NextResponse.json(
      { error: "assigneeMemberId must be null or positive integer" },
      { status: 400 },
    );
  }
  const recurrenceType =
    typeof body.recurrenceType === "string" &&
    ALLOWED_RECURRENCE.has(body.recurrenceType)
      ? body.recurrenceType
      : "weekly";
  // weekOfMonth は monthly のときだけ意味を持つ。weekly のときは強制 null
  const weekOfMonth =
    recurrenceType === "monthly" ? clampWeekOfMonth(body.weekOfMonth) : null;
  const estimatedHours = body.estimatedHours == null ? null : clampHours(body.estimatedHours);
  if (body.estimatedHours != null && estimatedHours == null) {
    return NextResponse.json(
      { error: "invalid estimatedHours" },
      { status: 400 },
    );
  }
  const notes =
    body.notes == null
      ? null
      : sanitizeText(body.notes, TEXT_LIMITS.taskNotes, { allowEmpty: true });
  const sortOrder =
    typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder)
      ? (body.sortOrder as number)
      : 0;

  const [row] = await db
    .insert(schema.recurringTasks)
    .values({
      title,
      assigneeMemberId,
      recurrenceType,
      weekOfMonth,
      estimatedHours: estimatedHours == null ? null : estimatedHours.toString(),
      notes,
      sortOrder,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
