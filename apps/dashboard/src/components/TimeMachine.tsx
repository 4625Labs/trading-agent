"use client";
import { useState } from "react";
import { DeltaBars, Histogram } from "./Bars";
import Icon from "./Icon";
import LineChart from "./LineChart";
import { Badge, Card, Empty, Err, Loading, ago, post, usd, usePoll } from "./ui";
import { histogram, meanCi, verdictOf } from "@/lib/stats";

const text = (v: any): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : v.text ?? v.label ?? v.verdict ?? v.summary ?? JSON.stringify(v));
const pick = (o: any, keys: string[]) => { for (const k of keys) if (typeof o?.[k] === "number" && Number.isFinite(o[k])) return o[k] as number; return null; };
function ciFrom(s: any): [number, number] | null {
  const c = s?.ci95 ?? s?.ci ?? s?.confidenceInterval ?? s?.ci_95;
  if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") return [c[0], c[1]];
  if (c && typeof c === "object") { const lo = pick(c, ["lo", "low", "lower"]), hi = pick(c, ["hi", "high", "upper"]); if (lo !== null && hi !== null) return [lo, hi]; }
  const lo = pick(s, ["ciLow", "ci_low", "ciLower", "ci95Low", "ci_lo"]), hi = pick(s, ["ciHigh", "ci_high", "ciUpper", "ci95High", "ci_hi"]);
  return lo !== null && hi !== null ? [lo, hi] : null;
}
const VARIANTS: [string, string][] = [["all", "All sources"], ["technical", "Technical only"]];
const variantOf = (w: any): string | null => { const v = String(w.detail?.variant ?? w.detail?.sources ?? "").toLowerCase(); return v.startsWith("tech") ? "technical" : v.startsWith("all") ? "all" : null; };

export default function TimeMachine() {
  const [sel, setSel] = useState("");
  const { data: d, error, reload } = usePoll<any>(`/api/rolling${sel ? `?run=${sel}` : ""}`, 3000);
  const [variant, setVariant] = useState("all");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const run = d?.run;
  const running = run?.status === "running";
  const total = Number(run?.params?.windows ?? 0) || 0;
  const pctDone = run && total ? Math.min(100, Math.round(((run.progress ?? 0) / total) * 100)) : 0;
  const S = run?.summary ?? {};
  const all: any[] = d?.windows ?? [];
  const present = new Set(all.map(variantOf).filter(Boolean));
  const hasToggle = present.size > 1;
  const ws = (hasToggle ? all.filter((w) => variantOf(w) === variant) : all).slice().sort((a, b) => new Date(a.start_ts ?? 0).getTime() - new Date(b.start_ts ?? 0).getTime());
  const deltas = ws.map((w) => w.delta ?? 0);
  const mine = meanCi(deltas);
  // prefer the worker's summary figures when they are for the whole (untoggled) set
  const sCi = !hasToggle ? ciFrom(S) : null;
  const lo = sCi ? sCi[0] : mine?.lo ?? null, hi = sCi ? sCi[1] : mine?.hi ?? null;
  const mean = (!hasToggle ? pick(S, ["meanDelta", "mean_delta", "mean", "avgDelta"]) : null) ?? mine?.mean ?? null;
  const t = (!hasToggle ? pick(S, ["t", "tStat", "t_stat", "tStatistic"]) : null) ?? mine?.t ?? null;
  const p = !hasToggle ? pick(S, ["signTestP", "sign_test_p", "p", "pValue", "p_value"]) : null;
  const won = ws.filter((w) => (w.delta ?? 0) > 0).length;
  const v = lo !== null && hi !== null ? verdictOf(lo, hi) : null;
  let cum = 0;
  const cumPts = ws.map((w, i) => ({ x: i + 1, y: (cum += w.delta ?? 0) }));

  async function start() {
    setBusy(true); setMsg(null);
    const r = await post("/api/rolling", {});
    setBusy(false);
    setMsg(r.ok ? { ok: true, t: "Requested. It takes about a minute." } : { ok: false, t: r.error ?? "failed" });
    reload();
  }
  return (
    <>
      <div className="banner"><Icon name="info" size={18} /><div><b>Time machine.</b> We pick many random moments in the past. For each one the agent learns for ~30 rounds, we freeze what it learned, and test it on the next ~20 rounds it has never seen, against an agent that treats all sources equally. If learning helps, the frozen learner should win most windows.</div></div>
      <Card title="Run the time machine test" icon="demo">
        <p className="muted small" style={{ marginTop: 0 }}>Free (no Claude calls). Takes about a minute.</p>
        <div className="btns"><button className="primary" disabled={busy || running} onClick={start}>Run time machine test</button></div>
        {msg && (msg.ok ? <div className="ok">{msg.t}</div> : <Err msg={msg.t} />)}
      </Card>
      <Err msg={error && !d ? error : null} />
      {!d ? <Loading /> : !run ? <Card><Empty icon="learning" title="No time machine runs yet">Start one above.</Empty></Card> : (
        <>
          <Card title="Run" icon="trace" right={<Badge s={run.status} />}>
            <select aria-label="Time machine run" value={run.id} onChange={(e) => setSel(e.target.value)}>
              {d.runs.map((r: any) => <option key={r.id} value={r.id}>{new Date(r.started_at).toLocaleString()} · {r.status}</option>)}
            </select>
            <div className="levels"><span>Windows <b>{run.progress ?? 0}{total ? `/${total}` : ""}</b></span><span>{ago(run.started_at)}</span></div>
            {running && total > 0 && <div className="bar" role="progressbar" aria-valuenow={pctDone} aria-valuemin={0} aria-valuemax={100} style={{ marginTop: 10 }}><i style={{ width: `${pctDone}%` }} /></div>}
            {run.error && <Err msg={run.error} />}
          </Card>
          <section className="hero">
            <div className="top-line"><div className="hero-title"><Icon name="learning" size={20} />Verdict</div>
              {v === "helped" ? <Badge s="learning helped" /> : v === "hurt" ? <Badge s="learning hurt" /> : v === "none" ? <span className="badge plain">no reliable difference</span> : <span className="badge plain">not enough windows</span>}</div>
            <div className="verdict">{text(S.verdict) || (running ? "Test in progress..." : "No verdict recorded yet.")}</div>
            <p className="small muted" style={{ margin: 0, position: "relative", zIndex: 1 }}><b>Disclaimer:</b> {text(S.disclaimer) || "Historical replay with simulated fills. It is not evidence of future performance."}</p>
          </section>
          {hasToggle && <div className="presets" style={{ marginBottom: 12 }}>{VARIANTS.filter(([k]) => present.has(k)).map(([k, l]) => <button key={k} aria-pressed={variant === k} onClick={() => setVariant(k)}>{l}</button>)}</div>}
          <div className="grid">
            <div className="stat"><div className="lbl">Windows run</div><div className="val num">{ws.length}</div></div>
            <div className="stat"><div className="lbl">Learner won</div><div className="val num">{won}</div><div className="sub">{ws.length ? Math.round((won / ws.length) * 100) + "% of windows" : "-"}</div></div>
            <div className="stat"><div className="lbl">Mean difference</div><div className={`val num ${mean === null ? "" : mean >= 0 ? "pos" : "neg"}`}>{mean === null ? "-" : usd(mean)}</div><div className="sub">per window, learned minus equal</div></div>
            <div className="stat"><div className="lbl">95% interval</div><div className="val num" style={{ fontSize: "1.2rem" }}>{lo === null || hi === null ? "-" : `${usd(lo)} to ${usd(hi)}`}</div><div className="sub">{t !== null ? `t = ${t.toFixed(2)}` : ""}{p !== null ? ` p = ${p.toFixed(3)}` : ""}</div></div>
          </div>
          <Card title="Difference per window (learned minus equal, USD)" icon="bars"><DeltaBars values={deltas} label="Per-window delta" /></Card>
          <Card title="Spread of differences" icon="bars"><Histogram bins={histogram(deltas)} label="Histogram of deltas" /></Card>
          <Card title="Cumulative difference" icon="bars"><LineChart label="Cumulative delta across windows" series={[{ name: "cumulative delta", color: "var(--c2)", pts: cumPts }]} /></Card>
          <Card title="Windows" icon="trace" right={<span className="muted">{ws.length}</span>}>
            {!ws.length ? <Empty icon="trace" title="No windows yet" /> : (
              <div className="scroll"><table className="table"><thead><tr><th>Start</th><th>Learned</th><th>Equal</th><th>Delta</th><th>Trades</th><th>Hit rate</th></tr></thead>
                <tbody>{ws.map((w) => <tr key={w.k + (variantOf(w) ?? "")}><td>{w.start_ts ? new Date(w.start_ts).toLocaleDateString() : `#${w.k}`}</td><td className="num">{usd(w.learned_pnl)}</td><td className="num">{usd(w.baseline_pnl)}</td>
                  <td className={`num ${(w.delta ?? 0) >= 0 ? "pos" : "neg"}`}>{usd(w.delta)}</td><td className="num">{w.learned_trades}/{w.baseline_trades}</td>
                  <td className="num">{w.learned_hit === null ? "-" : Math.round(w.learned_hit * (w.learned_hit <= 1 ? 100 : 1))}% / {w.baseline_hit === null ? "-" : Math.round(w.baseline_hit * (w.baseline_hit <= 1 ? 100 : 1))}%</td></tr>)}</tbody></table></div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
