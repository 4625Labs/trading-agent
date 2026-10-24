import { q, tryq } from "@/lib/db";
import { handle, num } from "@/lib/http";
import { readPrefs } from "@/lib/prefs";
export const dynamic = "force-dynamic";

async function health() {
  const url = process.env.WORKER_HEALTH_URL;
  if (!url) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    return { ok: r.ok, status: r.status };
  } catch { return { ok: false, status: 0 }; }
}

export function GET() {
  return handle(async () => {
    const [run, wallet, synth, real, open, prefs, hl, counts] = await Promise.all([
      tryq("select trigger,status,started_at,finished_at from runs order by started_at desc limit 1"),
      q("select balance,created_at from wallet_snapshots order by created_at desc limit 30"),
      q("select coalesce(closed_at,created_at) t, coalesce(pnl,0) pnl from synthetic_trades order by 1 asc limit 2000"),
      q("select created_at t, coalesce(pnl,0) pnl from real_trades order by 1 asc limit 2000"),
      q(`select t.id,t.asset,t.direction,t.entry,t.size,t.stop,t.target,t.confidence,t.status,t.created_at,
                (select fill_price from synthetic_trades s where s.thesis_id=t.id order by created_at desc limit 1) fill
         from theses t where t.status in ('executed','open') order by t.created_at desc limit 50`),
      readPrefs(),
      health(),
      q("select (select count(*) from approvals where status='pending')::int pending, (select count(*) from signals)::int signals, (select count(*) from theses)::int theses"),
    ]);
    const cum = (rows: any[]) => { let s = 0; return rows.map((r) => ({ t: new Date(r.t).getTime(), v: (s += Number(r.pnl)) })); };
    return {
      now: Date.now(),
      heartbeat: { lastRun: run.rows[0] ?? null, health: hl },
      wallet: { latest: num(wallet[0]?.balance), at: wallet[0]?.created_at ?? null, history: wallet.map((w) => ({ t: new Date(w.created_at).getTime(), v: Number(w.balance) })).reverse() },
      pnl: { synthetic: cum(synth), real: cum(real), syntheticTotal: synth.reduce((a, r) => a + Number(r.pnl), 0), realTotal: real.reduce((a, r) => a + Number(r.pnl), 0) },
      positions: open.map((p) => ({ ...p, entry: num(p.entry), size: num(p.size), stop: num(p.stop), target: num(p.target), fill: num(p.fill) })),
      killSwitch: !!prefs.killSwitch,
      counts: counts[0],
    };
  });
}
