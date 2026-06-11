import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { toIntId } from "@/lib/validate";
import {
  collectWorkloadBuckets,
  recomputeWorkloadBuckets,
} from "@/lib/project-workload";

export const dynamic = "force-dynamic";

export async function POST(
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
      const [row] = await tx
        .select({
          id: schema.projects.id,
          archivedAt: schema.projects.archivedAt,
        })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
      if (!row) throw new Error("PROJECT_NOT_FOUND");
      if (row.archivedAt) {
        return { alreadyArchived: true, adjustedWorkloadBuckets: 0 };
      }

      // 影響を受けるバケット (memberId, weekIso) を先に把握
      const buckets = await collectWorkloadBuckets(tx, projectId);

      // archivedAt を立ててからアクティブ全タスクで再計算（このプロジェクトは除外される）
      await tx
        .update(schema.projects)
        .set({ archivedAt: new Date() })
        .where(eq(schema.projects.id, projectId));

      await recomputeWorkloadBuckets(tx, buckets);

      return {
        alreadyArchived: false,
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
