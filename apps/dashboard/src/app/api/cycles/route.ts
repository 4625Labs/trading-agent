import { tryq } from "@/lib/db";
import { handle, num } from "@/lib/http";
export const dynamic = "force-dynamic";
export function GET() {
  return handle(async () => {
    const [c, cfg] = await Promise.all([
      tryq("select n,started_at,finished_at,signals_considered,new_signals,ideas,proposed,closed,wins,pnl,lessons_count,notes from cycles order by started_at desc limit 50"),
      tryq("select data from agent_config where id='default'"),
    ]);
    return {
      now: Date.now(),
      intervalSeconds: Number(cfg.rows[0]?.data?.intervalSeconds ?? 300),
      enabled: cfg.rows[0]?.data?.enabled ?? null,
      cycles: c.rows.map((r: any) => ({ ...r, pnl: num(r.pnl) })),
    };
  });
}
