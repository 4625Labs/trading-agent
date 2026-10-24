// Applies supabase/migrations/*.sql in order, tracking applied files. Never prints the connection string.
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
const url = process.env.DATABASE_URL;
const redact = (t) => String(t).split(url).join("<db-url>").replace(/postgres(ql)?:\/\/[^\s]+/g, "<db-url>");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
try {
  await c.connect();
  await c.query("create table if not exists _migrations (name text primary key, applied_at timestamptz default now())");
  const done = new Set((await c.query("select name from _migrations")).rows.map((r) => r.name));
  for (const f of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) { console.log("skip", f); continue; }
    await c.query("begin");
    try { await c.query(readFileSync(`supabase/migrations/${f}`, "utf8")); await c.query("insert into _migrations(name) values ($1)", [f]); await c.query("commit"); console.log("applied", f); }
    catch (e) { await c.query("rollback"); throw e; }
  }
  const t = await c.query("select table_name from information_schema.tables where table_schema='public' order by 1");
  console.log("tables:", t.rows.map((r) => r.table_name).join(","));
} catch (e) { console.log("FAIL", redact(e.message)); process.exitCode = 1; }
finally { await c.end().catch(() => {}); }
