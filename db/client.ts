import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type DbClient = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __pgPool?: Pool;
  __db?: DbClient;
};

function getPool(): Pool {
  if (globalForDb.__pgPool) return globalForDb.__pgPool;
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__pgPool = pool;
  } else {
    globalForDb.__pgPool = pool;
  }
  return pool;
}

function getDb(): DbClient {
  if (globalForDb.__db) return globalForDb.__db;
  const client = drizzle(getPool(), { schema });
  globalForDb.__db = client;
  return client;
}

export const db = new Proxy({} as DbClient, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
}) as DbClient;

export { schema };
