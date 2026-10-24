import { q, tryq } from "@/lib/db";
import { HttpError, UUID, body, handle, num } from "@/lib/http";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(async () => {
    const wanted = new URL(req.url).searchParams.get("run");
    if (wanted && !UUID.test(wanted)) throw new HttpError(400, "invalid run id");
    const runs = await tryq("select id,started_at,finished_at,status,params,progress,summary,error from replay_runs order by started_at desc limit 20");
    const run = wanted ? runs.rows.find((r: any) => r.id === wanted) : runs.rows[0];
    let cycles: any[] = [];
    if (run) {
      const r = await tryq("select n,arm,sim_ts,trades,pnl,cum_pnl,hit_rate_20,brier,case when arm='learner' then weights else null end weights,lessons from replay_cycles where run_id=$1 order by arm,n limit 6000", [run.id]);
      cycles = r.rows.map((x: any) => ({ ...x, pnl: num(x.pnl), cum_pnl: num(x.cum_pnl), hit_rate_20: num(x.hit_rate_20), brier: num(x.brier) }));
    }
    return { runs: runs.rows.map((r: any) => ({ id: r.id, started_at: r.started_at, status: r.status, params: r.params, progress: r.progress })), run: run ?? null, cycles };
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    if (typeof b.llm !== "boolean") throw new HttpError(400, "llm must be true or false");
    const payload: Record<string, unknown> = { llm: b.llm };
    if (b.seed !== undefined && b.seed !== null) {
      if (typeof b.seed !== "number" || !Number.isInteger(b.seed) || b.seed < 0 || b.seed > 2147483647) throw new HttpError(400, "seed must be an integer between 0 and 2147483647");
      payload.seed = b.seed;
    }
    if ((await q("select 1 from replay_runs where status='running' limit 1")).length) throw new HttpError(409, "a replay is already running");
    if ((await q("select 1 from commands where kind='replay_run' and status='pending' limit 1")).length) throw new HttpError(409, "a replay has already been requested and is waiting for the worker");
    if ((await q("select 1 from commands where kind='replay_run' and created_at > now() - interval '10 seconds' limit 1")).length) throw new HttpError(429, "please wait a few seconds before requesting another replay");
    const r = await q("insert into commands(kind,payload) values ('replay_run',$1::jsonb) returning id,kind,payload,status,created_at", [JSON.stringify(payload)]);
    return { command: r[0] };
  });
}
