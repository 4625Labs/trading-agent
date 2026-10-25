import { q, tryq } from "@/lib/db";
import { HttpError, UUID, body, handle, num } from "@/lib/http";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(async () => {
    const wanted = new URL(req.url).searchParams.get("run");
    if (wanted && !UUID.test(wanted)) throw new HttpError(400, "invalid run id");
    const runs = await tryq("select id,started_at,finished_at,status,params,progress,summary,error from rolling_runs order by started_at desc limit 20");
    const run = wanted ? runs.rows.find((r: any) => r.id === wanted) : runs.rows[0];
    let windows: any[] = [];
    if (run) {
      const w = await tryq(`select k,start_ts,learn_cycles,test_cycles,learned_pnl,baseline_pnl,delta,learned_trades,baseline_trades,learned_hit,baseline_hit,detail
                            from rolling_windows where run_id=$1 order by start_ts nulls last, k limit 500`, [run.id]);
      windows = w.rows.map((x: any) => ({ ...x, learned_pnl: num(x.learned_pnl), baseline_pnl: num(x.baseline_pnl), delta: num(x.delta), learned_hit: num(x.learned_hit), baseline_hit: num(x.baseline_hit) }));
    }
    return { runs: runs.rows.map((r: any) => ({ id: r.id, started_at: r.started_at, status: r.status, params: r.params, progress: r.progress })), run: run ?? null, windows };
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    const payload: Record<string, unknown> = {};
    if (b.windows !== undefined && b.windows !== null) {
      if (typeof b.windows !== "number" || !Number.isInteger(b.windows) || b.windows < 5 || b.windows > 60) throw new HttpError(400, "windows must be an integer between 5 and 60");
      payload.windows = b.windows;
    }
    if (b.seed !== undefined && b.seed !== null) {
      if (typeof b.seed !== "number" || !Number.isInteger(b.seed) || b.seed < 0 || b.seed > 2147483647) throw new HttpError(400, "seed must be an integer between 0 and 2147483647");
      payload.seed = b.seed;
    }
    if ((await q("select 1 from rolling_runs where status='running' limit 1")).length) throw new HttpError(409, "a time machine run is already in progress");
    if ((await q("select 1 from commands where kind='rolling_run' and status='pending' limit 1")).length) throw new HttpError(409, "a run has already been requested and is waiting for the worker");
    if ((await q("select 1 from commands where kind='rolling_run' and created_at > now() - interval '10 seconds' limit 1")).length) throw new HttpError(429, "please wait a few seconds before requesting another run");
    const r = await q("insert into commands(kind,payload) values ('rolling_run',$1::jsonb) returning id,kind,payload,status,created_at", [JSON.stringify(payload)]);
    return { command: r[0] };
  });
}
