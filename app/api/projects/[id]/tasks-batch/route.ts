import { db, schema } from "@/db/client";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  clampHours,
  isValidWeekIso,
  sanitizeText,
  TEXT_LIMITS,
  toIntId,
} from "@/lib/validate";
import { applyWorkloadIncrements } from "@/lib/workload-apply";
import { getViewerMemberId, visibilityCondition } from "@/lib/visibility";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type IncomingTask = {
  title: unknown;
  weekIso: unknown;
  assigneeMemberId?: unknown;
  notes?: unknown;
  sortOrder?: unknown;
  estimatedHours?: unknown;
};

/**
 * 既存プロジェクトに対するタスク一括追加。
 *
 * - 書込み認証は `middleware.ts` の cookie ガードに任せる
 * - project が存在 + 未アーカイブ であることを確認
 * - tasks の整形ルールと workload 加算は `POST /api/projects`（新規作成）と同一
 * - tx 内で tasks insert と workload upsert を完結させ、部分失敗を防ぐ
 *
 * sortOrder は既存タスクの末尾以降に振る。フロントで明示指定があればそれを優先するが、
 * 競合した場合は (sortOrder, id) のタイブレークで TaskBoard 側が処理するため安全。
 */
export async function POST(
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

  // project の存在 / 未アーカイブ / 閲覧可（=書込可とみなす）の三重確認。
  // 非公開プロジェクトに対して、cookie 認証はあるが閲覧権限のないメンバーが
  // 他者の workload を改ざんできるのを防ぐ。条件は GET /api/projects と同じ
  // visibilityCondition() を使う。
  const viewerMemberId = await getViewerMemberId(req);
  const [project] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        isNull(schema.projects.archivedAt),
        visibilityCondition(viewerMemberId),
      ),
    )
    .limit(1);
  if (!project) {
    return NextResponse.json(
      { error: "project not found, archived, or not visible" },
      { status: 404 },
    );
  }

  // タスク配列の事前検証（上限を厳格化）
  const MAX_INCOMING_TASKS = 50;
  const incoming = Array.isArray(body.tasks)
    ? (body.tasks as IncomingTask[]).slice(0, MAX_INCOMING_TASKS)
    : [];
  if (incoming.length === 0) {
    return NextResponse.json(
      { error: "tasks must be a non-empty array" },
      { status: 400 },
    );
  }

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
    const estimated =
      t.estimatedHours == null ? null : clampHours(t.estimatedHours);
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

  if (cleanTasks.length === 0) {
    return NextResponse.json(
      { error: "no valid tasks after sanitization" },
      { status: 400 },
    );
  }

  const result = await db.transaction(async (tx) => {
    // tx 内で再チェック: precheck と insert の間にアーカイブされても弾く。
    // baseSortOrder 取得も同じ tx に閉じて、並列実行時の race を避ける。
    const [stillActive] = await tx
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.id, projectId),
          isNull(schema.projects.archivedAt),
        ),
      )
      .limit(1);
    if (!stillActive) {
      return { archived: true as const };
    }

    const existing = await tx
      .select({ sortOrder: schema.tasks.sortOrder })
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId));
    const baseSortOrder =
      existing.length > 0
        ? Math.max(...existing.map((r) => r.sortOrder)) + 1
        : 0;

    const rows = await tx
      .insert(schema.tasks)
      .values(
        cleanTasks.map((t, idx) => ({
          projectId,
          title: t.title,
          weekIso: t.weekIso,
          assigneeMemberId: t.assigneeMemberId,
          notes: t.notes,
          // フロントが明示している場合はそれを尊重しつつ既存末尾以降にオフセット
          sortOrder: baseSortOrder + idx,
          estimatedHours:
            t.estimatedHours == null ? null : t.estimatedHours.toString(),
        })),
      )
      .returning();

    await applyWorkloadIncrements(tx, cleanTasks);

    return { archived: false as const, rows };
  });

  if (result.archived) {
    return NextResponse.json(
      { error: "project was archived during this request" },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { inserted: result.rows.length, tasks: result.rows },
    { status: 201 },
  );
}
