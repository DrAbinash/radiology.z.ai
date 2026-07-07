import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set (point at the radiology Postgres container).");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on("error", (err: Error) => {
  const safe = err.message.replace(/postgres(?:ql)?:\/\/[^@]+@[^\s/]*/gi, "postgres://***:***@***");
  console.error("[db] Idle client error:", safe);
});

export const db = drizzle(pool, { schema });
export * from "./schema";
