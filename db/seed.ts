import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { members } from "./schema";

// mb-schedule (Mebius 編成) の初期メンバー。
// 佐々木 / 和田 / 山田 は ig-schedule と同色、ほか 6 名は mebius の teal / steel blue / coral 系を割り振った
// （preview で違和感があれば DB の members.color を後から更新する）。
// 佐々木を admin に。AdminMemberPasswordsModal 等 admin 限定 UI のために、初期状態で誰か 1 人は admin になっている必要がある。
const SEED_MEMBERS = [
  { name: "佐々木", color: "#15A03A", role: null, isAdmin: true  },
  { name: "和田",   color: "#1A73E8", role: null, isAdmin: false },
  { name: "山田",   color: "#7C3AED", role: null, isAdmin: false },
  { name: "安田",   color: "#00ABBF", role: null, isAdmin: false },
  { name: "高野",   color: "#3F5680", role: null, isAdmin: false },
  { name: "小畠",   color: "#E15A4F", role: null, isAdmin: false },
  { name: "近岡",   color: "#D98E1F", role: null, isAdmin: false },
  { name: "中澤",   color: "#0F8A6E", role: null, isAdmin: false },
  { name: "堀内",   color: "#A24C8F", role: null, isAdmin: false },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  const db = drizzle(pool);

  console.log("seeding members…");
  const existing = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from members`,
  );
  if (Number(existing.rows[0].count) > 0) {
    console.log("members already seeded, skipping. (count =", existing.rows[0].count, ")");
  } else {
    await db.insert(members).values(
      SEED_MEMBERS.map((m, i) => ({ ...m, sortOrder: i })),
    );
    console.log(`inserted ${SEED_MEMBERS.length} members.`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
