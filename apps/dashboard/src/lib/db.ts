import pg from "pg";

const g = globalThis as unknown as { __dashPool?: pg.Pool };
function pool(): pg.Pool {
  if (!g.__dashPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    g.__dashPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });
  }
  return g.__dashPool;
}

export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool().query(sql, params)).rows as T[];
}
/** Query that never throws (for optional tables). */
export async function tryq<T = any>(sql: string, params: unknown[] = []): Promise<{ rows: T[]; error?: string }> {
  try { return { rows: await q<T>(sql, params) }; } catch (e) { return { rows: [], error: "unavailable" }; }
}
