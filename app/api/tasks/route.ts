import { db, schema } from "@/db/client";
import { and, asc, gte, inArray, lte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  clampHours,
  isValidWeekIso,
  sanitizeText,
  TEXT_LIMITS,
  toIntId,
} from "@/lib/validate";
import { getViewerMemberId, getVisibleProjectIds } from "@/lib/visibility";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const weekFrom = url.searchParams.get("weekFrom");
  const weekTo = url.searchParams.get("weekTo");
  const memberIds = url.searchParams.get("memberIds");
  const projectIds = url.searchParams.get("projectIds");

  const memberId = await getViewerMemberId(req);
  const visibleIds = await getVisibleProjectIds(memberId);

  const conds = [] as Array<
    ReturnType<typeof gte> | ReturnType<typeof lte> | ReturnType<typeof inArray>
  >;
  if (weekFrom && isValidWeekIso(weekFrom))
    conds.push(gte(schema.tasks.weekIso, weekFrom));
  if (weekTo && isValidWeekIso(weekTo))
    conds.push(lte(schema.tasks.weekIso, weekTo));
  if (memberIds) {
    const ids = memberIds.split(",").map(Number).filter(Number.isFinite);
    if (ids.length) conds.push(inArray(schema.tasks.assigneeMemberId, ids));
  }
  // requested projectIds は visibleIds と AND を取る
  let projectScope = visibleIds;
  if (projectIds) {
    const ids = projectIds.split(",").map(Number).filter(Number.isFinite);
    projectScope = projectScope.filter((id) => ids.includes(id));
  }
  if (projectScope.length === 0) {
    return NextResponse.json([]);
  }
  conds.push(inArray(schema.tasks.projectId, projectScope));

  const rows = await db
    .select()
    .from(schema.tasks)
    .where(and(...conds))
    .orderBy(
      asc(schema.tasks.weekIso),
      asc(schema.tasks.sortOrder),
      asc(schema.tasks.id),
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

  const projectId = toIntId(body.projectId);
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId must be a positive integer" },
      { status: 400 },
    );
  }
  if (!isValidWeekIso(body.weekIso)) {
    return NextResponse.json(
      { error: "weekIso must match YYYY-Www" },
      { status: 400 },
    );
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
  const notes =
    body.notes == null
      ? null
      : sanitizeText(body.notes, TEXT_LIMITS.taskNotes, { allowEmpty: true });
  const estimatedHours = body.estimatedHours == null ? null : clampHours(body.estimatedHours);
  const sortOrder =
    typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder)
      ? (body.sortOrder as number)
      : 0;

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(schema.tasks)
      .values({
        projectId,
        title,
        weekIso: body.weekIso as string,
        assigneeMemberId,
        notes,
        estimatedHours:
          estimatedHours == null ? null : estimatedHours.toString(),
        sortOrder,
      })
      .returning();

    if (
      assigneeMemberId &&
      estimatedHours != null &&
      estimatedHours > 0
    ) {
      await tx
        .insert(schema.workload)
        .values({
          memberId: assigneeMemberId,
          weekIso: body.weekIso as string,
          plannedHours: estimatedHours.toString(),
        })
        .onConflictDoUpdate({
          target: [schema.workload.memberId, schema.workload.weekIso],
          set: {
            plannedHours: sql`${schema.workload.plannedHours} + ${estimatedHours}`,
            updatedAt: sql`now()`,
          },
        });
    }

    return inserted;
  });
  return NextResponse.json(row, { status: 201 });
}
