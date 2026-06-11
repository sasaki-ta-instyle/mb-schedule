import { db, schema } from "@/db/client";
import { and, asc, gte, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isValidWeekIso } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const weekFrom = url.searchParams.get("weekFrom");
  const weekTo = url.searchParams.get("weekTo");

  const conds = [] as Array<ReturnType<typeof gte> | ReturnType<typeof lte>>;
  if (weekFrom && isValidWeekIso(weekFrom))
    conds.push(gte(schema.recurringTaskCompletions.weekIso, weekFrom));
  if (weekTo && isValidWeekIso(weekTo))
    conds.push(lte(schema.recurringTaskCompletions.weekIso, weekTo));

  const rows = await db
    .select()
    .from(schema.recurringTaskCompletions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(schema.recurringTaskCompletions.weekIso));
  return NextResponse.json(rows);
}
