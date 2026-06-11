import { db, schema } from "@/db/client";
import { asc, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      color: schema.members.color,
      role: schema.members.role,
      sortOrder: schema.members.sortOrder,
      hasPassword: schema.members.passwordHash,
      isAdmin: schema.members.isAdmin,
    })
    .from(schema.members)
    .where(isNull(schema.members.archivedAt))
    .orderBy(asc(schema.members.sortOrder), asc(schema.members.id));
  return Response.json(
    rows.map((r) => ({ ...r, hasPassword: Boolean(r.hasPassword) })),
  );
}
