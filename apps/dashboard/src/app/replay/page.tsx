"use client";
import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import LineChart, { type S } from "@/components/LineChart";
import { Badge, Card, Empty, Err, Loading, Title, ago, post, usd, usePoll } from "@/components/ui";

const ARM_COLOR: Record<string, string> = { learner: "#a78bfa", baseline: "#94a3b8", llm_lessons: "#22d3ee", llm_nolessons: "#fbbf24" };
const PALETTE = ["#a78bfa", "#22d3ee", "#fbbf24", "#34d399", "#fb7185", "#60a5fa", "#f472b6", "#a3e635"];
const text = (v: any): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : v.text ?? v.label ?? v.verdict ?? v.summary ?? JSON.stringify(v));
const n = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function rowsOf(v: any): any[] {
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object");
  if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => (x && typeof x === "object" ? { source: k, ...(x as any) } : { source: k, value: x }));
  return [];
}

export default function Replay() {
  const [sel, setSel] = useState("");
  const { data: d, error, at, reload } = usePoll<any>(`/api/replay${sel ? `?run=${sel}` : ""}`, 3000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const run = d?.run;
  const running = run?.status === "running";
  const total = Number(run?.params?.cycles ?? 100) || 100;
  const pctDone = run ? Math.min(100, Math.round(((run.progress ?? 0) / total) * 100)) : 0;
  const summary = run?.summary ?? {};
  const cyc: any[] = d?.cycles ?? [];
  const arms = [...new Set(cyc.map((c) => c.arm))];
  const byArm = (f: (c: any) => number | null): S[] => arms.map((a) => ({ name: a, color: ARM_COLOR[a] ?? "#e5e7eb", pts: cyc.filter((c) => c.arm === a).map((c) => ({ x: c.n, y: f(c) as number })).filter((p) => p.y !== null && Number.isFinite(p.y)) }));
  // source weights over cycles (learner arm)
  const wc = cyc.filter((c) => c.arm === "learner" && c.weights && typeof c.weights === "object");
  const srcs = [...new Set(wc.flatMap((c) => Object.keys(c.weights)))];
  const weightSeries: S[] = srcs.map((s, i) => ({ name: s, color: PALETTE[i % PALETTE.length], pts: wc.filter((c) => n(Number(c.weights[s])) !== null && c.weights[s] !== undefined).map((c) => ({ x: c.n, y: Number(c.weights[s]) })) }));
  // first vs second half
  const half = arms.map((a) => {
    const rows = cyc.filter((c) => c.arm === a), mid = Math.floor(rows.length / 2);
    const sm = summary.arms?.[a] ?? {};
    const sumP = (r: any[]) => r.reduce((x, c) => x + (c.pnl ?? 0), 0);
    return { arm: a, first: n(sm.firstHalfPnl) ?? sumP(rows.slice(0, mid)), second: n(sm.secondHalfPnl) ?? sumP(rows.slice(mid)), fh: n(sm.firstHalfHitRate), sh: n(sm.secondHalfHitRate) };
  });
  const maxAbs = Math.max(1e-9, ...half.flatMap((h) => [Math.abs(h.first), Math.abs(h.second)]));
  const srcRows = rowsOf(summary.sources ?? summary.sourceRanking ?? summary.source_ranking);
  const cols = srcRows[0] ? Object.keys(srcRows[0]).slice(0, 6) : [];

  async function start(llm: boolean) {
    if (llm && !confirm("Run the replay with Claude A/B? This costs roughly $3 to $6 in API usage.")) return;
    setBusy(true); setMsg(null);
    const r = await post("/api/replay", { llm });
    setBusy(false);
    setMsg(r.ok ? { ok: true, t: "Requested. The worker will start it shortly." } : { ok: false, t: r.error ?? "failed" });
    reload();
  }
  return (
    <>
      <Title icon="learning" at={at} error={error}>100-cycle replay</Title>
      <p><Link href="/learning">Back to Learning</Link></p>
      <Err msg={error && !d ? error : null} />
      {!d ? <Loading /> : (
        <>
          <Card title="Run a replay" icon="demo">
            <p className="muted small" style={{ marginTop: 0 }}>Replays 100 decision cycles on historical prices through the real decision code.</p>
            <div className="btns">
              <button className="primary" disabled={busy || running} onClick={() => start(false)}>Run (math only)</button>
              <button disabled={busy || running} onClick={() => start(true)}>Run with Claude A/B (about $3-6)</button>
            </div>
            {msg && (msg.ok ? <div className="ok">{msg.t}</div> : <Err msg={msg.t} />)}
          </Card>
          {!run ? <Card><Empty icon="learning" title="No replay runs yet">Start one above; results appear here.</Empty></Card> : (
            <>
              <Card title="Run" icon="trace" right={<Badge s={run.status} />}>
                <select aria-label="Replay run" value={run.id} onChange={(e) => setSel(e.target.value)}>
                  {d.runs.map((r: any) => <option key={r.id} value={r.id}>{new Date(r.started_at).toLocaleString()} · {r.status}{r.params?.llm ? " · Claude A/B" : " · math only"}</option>)}
                </select>
                <div className="levels"><span>Cycles <b>{run.progress ?? 0}/{total}</b></span>{run.params?.seed !== undefined && <span>Seed <b>{String(run.params.seed)}</b></span>}<span>{ago(run.started_at)}</span></div>
                {(running || pctDone < 100) && <div className="bar" role="progressbar" aria-valuenow={pctDone} aria-valuemin={0} aria-valuemax={100} style={{ marginTop: 10 }}><i style={{ width: `${pctDone}%` }} /></div>}
                {run.error && <Err msg={run.error} />}
              </Card>
              <section className="hero">
                <div className="top-line"><div className="hero-title"><Icon name="learning" size={20} />Verdict</div><Badge s={run.status} /></div>
                <div className="verdict">{text(summary.verdict) || (running ? "Replay in progress..." : "No verdict recorded yet.")}</div>
                <p className="small muted" style={{ margin: 0, position: "relative", zIndex: 1 }}><b>Disclaimer:</b> {text(summary.disclaimer) || "This is a replay on historical data with simulated fills; it is not evidence of future performance."}</p>
              </section>
              <Card title="Cumulative PnL by cycle" icon="bars"><LineChart label="Cumulative PnL by replay cycle" series={byArm((c) => c.cum_pnl)} /></Card>
              <Card title="Rolling 20-cycle hit rate" icon="approvals"><LineChart label="Rolling hit rate" zero={false} series={byArm((c) => (c.hit_rate_20 === null ? null : c.hit_rate_20 * (c.hit_rate_20 <= 1 ? 100 : 1)))} fmt={(v) => Math.round(v) + "%"} /></Card>
              <Card title="Brier score by cycle (lower is better)" icon="learning"><LineChart label="Brier score" zero={false} series={byArm((c) => c.brier)} fmt={(v) => v.toFixed(3)} /></Card>
              <Card title="Source weights over cycles" icon="feed">{weightSeries.length ? <LineChart label="Source weights" zero={false} area={false} series={weightSeries} /> : <Empty icon="feed" title="No weight history">Learner weights appear once the run records them.</Empty>}</Card>
              <Card title="First half vs second half" icon="bars">
                {!half.length ? <Empty icon="bars" title="Not enough data" /> : half.map((h) => (
                  <div className="item" key={h.arm}>
                    <b>{h.arm.replace(/_/g, " ")}</b>
                    <div className="pair">
                      <div className="r"><span className="muted">First half</span><i style={{ width: `${(Math.abs(h.first) / maxAbs) * 100}%`, background: ARM_COLOR[h.arm] ?? "#aaa", opacity: 0.55 }} /><span className="num">{usd(h.first)}</span></div>
                      <div className="r"><span className="muted">Second half</span><i style={{ width: `${(Math.abs(h.second) / maxAbs) * 100}%`, background: ARM_COLOR[h.arm] ?? "#aaa" }} /><span className="num">{usd(h.second)}</span></div>
                    </div>
                    {h.fh !== null && h.sh !== null && <div className="small muted">Hit rate {Math.round(h.fh * (h.fh <= 1 ? 100 : 1))}% to {Math.round(h.sh * (h.sh <= 1 ? 100 : 1))}%</div>}
                  </div>
                ))}
              </Card>
              {srcRows.length > 0 && (
                <Card title="Learned source ranking vs planted truth" icon="feed">
                  <div className="scroll"><table className="table"><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>{srcRows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className="num">{typeof r[c] === "number" ? (Number.isInteger(r[c]) ? r[c] : r[c].toFixed(3)) : typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c] ?? "-")}</td>)}</tr>)}</tbody></table></div>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
