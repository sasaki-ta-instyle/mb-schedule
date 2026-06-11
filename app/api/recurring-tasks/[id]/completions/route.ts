import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isValidWeekIso, toIntId } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
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
  if (!isValidWeekIso(body.weekIso)) {
    return NextResponse.json(
      { error: "weekIso must match YYYY-Www" },
      { status: 400 },
    );
  }
  if (typeof body.done !== "boolean") {
    return NextResponse.json(
      { error: "done must be boolean" },
      { status: 400 },
    );
  }

  const weekIso = body.weekIso as string;

  if (body.done) {
    const [row] = await db
      .insert(schema.recurringTaskCompletions)
      .values({ recurringTaskId: rid, weekIso })
      .onConflictDoNothing()
      .returning();
    if (row) {
      return NextResponse.json(row, { status: 201 });
    }
    const [existing] = await db
      .select()
      .from(schema.recurringTaskCompletions)
      .where(
        and(
          eq(schema.recurringTaskCompletions.recurringTaskId, rid),
          eq(schema.recurringTaskCompletions.weekIso, weekIso),
        ),
      )
      .limit(1);
    return NextResponse.json(existing ?? { ok: true });
  } else {
    await db
      .delete(schema.recurringTaskCompletions)
      .where(
        and(
          eq(schema.recurringTaskCompletions.recurringTaskId, rid),
          eq(schema.recurringTaskCompletions.weekIso, weekIso),
        ),
      );
    return NextResponse.json({ ok: true });
  }
}
