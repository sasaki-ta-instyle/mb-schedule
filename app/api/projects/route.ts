import { db, schema } from "@/db/client";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  clampHours,
  isPositiveIntArray,
  isValidIsoDate,
  isValidProjectStatus,
  isValidWeekIso,
  sanitizeText,
  TEXT_LIMITS,
  toIntId,
} from "@/lib/validate";
import { isKnownCompany } from "@/lib/companies";
import { getViewerMemberId, visibilityCondition } from "@/lib/visibility";
import { applyWorkloadIncrements } from "@/lib/workload-apply";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const archived = url.searchParams.get("archived") === "1";
  const memberId = await getViewerMemberId(req);
  const rows = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        archived
          ? isNotNull(schema.projects.archivedAt)
          : isNull(schema.projects.archivedAt),
        visibilityCondition(memberId),
      ),
    )
    .orderBy(
      archived
        ? asc(schema.projects.archivedAt)
        : asc(schema.projects.sortOrder),
      asc(schema.projects.id),
    );
  return NextResponse.json(rows);
}

type IncomingTask = {
  title: unknown;
  weekIso: unknown;
  assigneeMemberId?: unknown;
  notes?: unknown;
  sortOrder?: unknown;
  estimatedHours?: unknown;
};

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const name = sanitizeText(body.name, TEXT_LIMITS.projectName);
  if (!name) {
    return NextResponse.json(
      { error: `name must be 1..${TEXT_LIMITS.projectName} chars` },
      { status: 400 },
    );
  }
  const summary = sanitizeText(body.summary, TEXT_LIMITS.projectSummary, {
    allowEmpty: true,
  }) ?? "";
  const notes = sanitizeText(body.notes, TEXT_LIMITS.projectNotes, {
    allowEmpty: true,
  }) ?? "";
  const dueDate = isValidIsoDate(body.dueDate) ? body.dueDate : null;
  const status = isValidProjectStatus(body.status) ? body.status : "active";
  const company = isKnownCompany(body.company) ? body.company : null;
  const plannedMemberIds = isPositiveIntArray(body.plannedMemberIds)
    ? (body.plannedMemberIds as number[])
    : [];
  const isPrivate = body.isPrivate === true;
  const visibleMemberIds = isPositiveIntArray(body.visibleMemberIds)
    ? (body.visibleMemberIds as number[]).filter((id) => !plannedMemberIds.includes(id))
    : [];

  // タスク配列の事前検証（上限を厳格化）
  const MAX_INCOMING_TASKS = 50;
  const incoming = Array.isArray(body.tasks)
    ? (body.tasks as IncomingTask[]).slice(0, MAX_INCOMING_TASKS)
    : [];
  type CleanTask = {
    title: string;
    weekIso: string;
    assigneeMemberId: number | null;
    notes: string | null;
    sortOrder: number;
    estimatedHours: number | null;
  };
  const cleanTasks: CleanTask[] = [];
  for (let i = 0; i < incoming.length; i++) {
    const t = incoming[i];
    const title = sanitizeText(t.title, TEXT_LIMITS.taskTitle);
    if (!title) continue;
    if (!isValidWeekIso(t.weekIso)) continue;
    const assignee =
      t.assigneeMemberId == null ? null : toIntId(t.assigneeMemberId);
    if (t.assigneeMemberId != null && assignee == null) continue;
    const notes =
      t.notes == null
        ? null
        : sanitizeText(t.notes, TEXT_LIMITS.taskNotes, { allowEmpty: true });
    const estimated = t.estimatedHours == null ? null : clampHours(t.estimatedHours);
    cleanTasks.push({
      title,
      weekIso: t.weekIso as string,
      assigneeMemberId: assignee,
      notes,
      sortOrder:
        typeof t.sortOrder === "number" && Number.isInteger(t.sortOrder)
          ? (t.sortOrder as number)
          : i,
      estimatedHours: estimated,
    });
  }

  type AiSeed = {
    summary: string;
    dueDate?: string;
    plannedMemberIds: number[];
    model?: string;
  } | null;
  const aiSeed: AiSeed =
    body.aiSeed && typeof body.aiSeed === "object"
      ? (body.aiSeed as AiSeed)
      : null;

  const project = await db.transaction(async (tx) => {
    let color = "#38537B";
    if (plannedMemberIds.length > 0) {
      const [primary] = await tx
        .select({ color: schema.members.color })
        .from(schema.members)
        .where(eq(schema.members.id, plannedMemberIds[0]))
        .limit(1);
      if (primary?.color) color = primary.color;
    }

    const [projectRow] = await tx
      .insert(schema.projects)
      .values({
        name,
        summary,
        notes,
        company,
        dueDate,
        color,
        status,
        plannedMemberIds,
        isPrivate,
        visibleMemberIds,
        aiSeed,
      })
      .returning();

    if (cleanTasks.length > 0) {
      await tx.insert(schema.tasks).values(
        cleanTasks.map((t) => ({
          projectId: projectRow.id,
          title: t.title,
          weekIso: t.weekIso,
          assigneeMemberId: t.assigneeMemberId,
          notes: t.notes,
          sortOrder: t.sortOrder,
          estimatedHours:
            t.estimatedHours == null ? null : t.estimatedHours.toString(),
        })),
      );

      await applyWorkloadIncrements(tx, cleanTasks);
    }

    return projectRow;
  });

  return NextResponse.json(project, { status: 201 });
}
