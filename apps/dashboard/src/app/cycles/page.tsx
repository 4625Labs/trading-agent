"use client";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import LineChart from "@/components/LineChart";
import { Badge, Card, Empty, Err, Loading, Title, ago, post, usd, usePoll } from "@/components/ui";

const PRESETS: [string, number][] = [["2 min", 120], ["5 min", 300], ["30 min", 1800], ["1 hour", 3600]];
const fmtDur = (s: number) => (s < 90 ? `${Math.round(s)}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

function Config({ onSaved }: { onSaved: () => void }) {
  const { data, error } = usePoll<any>("/api/config", 60000);
  const [f, setF] = useState<any>(null);
  const [custom, setCustom] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data && !f) { setF(data.config); setCustom(!PRESETS.some(([, s]) => s === data.config.intervalSeconds)); } }, [data, f]);
  if (error && !data) return <Err msg={error} />;
  if (!f) return <div className="sk" style={{ height: 240 }} />;
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const toggleAsset = (a: string) => set("assets", f.assets.includes(a) ? f.assets.filter((x: string) => x !== a) : [...f.assets, a]);
  async function save() {
    setBusy(true); setMsg(null);
    const r = await post("/api/config", f);
    setBusy(false);
    setMsg(r.ok ? { ok: true, t: "Saved. Applies on the next cycle." } : { ok: false, t: r.error ?? "failed" });
    if (r.ok) onSaved();
  }
  return (
    <>
      {!data.saved && <p className="small muted">Showing defaults until you save.</p>}
      <div className="toggle"><div><b>Run cycles automatically</b><div className="small muted">When off, the agent only acts on demand.</div></div><button type="button" aria-pressed={f.enabled} onClick={() => set("enabled", !f.enabled)}>{f.enabled ? "On" : "Off"}</button></div>
      <label className="fld">Cycle interval
        <div className="presets">
          {PRESETS.map(([l, s]) => <button type="button" key={s} aria-pressed={!custom && f.intervalSeconds === s} onClick={() => { setCustom(false); set("intervalSeconds", s); }}>{l}</button>)}
          <button type="button" aria-pressed={custom} onClick={() => setCustom(true)}>Custom</button>
        </div>
        {custom && <><input type="number" min={60} max={86400} step={30} inputMode="numeric" value={f.intervalSeconds} onChange={(e) => set("intervalSeconds", e.target.value === "" ? "" : Number(e.target.value))} /><small>Seconds, 60 to 86400.</small></>}
      </label>
      <div style={{ height: 12 }} />
      <label className="fld">Assets to trade
        <div className="presets">{["BTC", "ETH", "SOL"].map((a) => <button type="button" key={a} aria-pressed={f.assets.includes(a)} onClick={() => toggleAsset(a)}>{a}</button>)}</div>
      </label>
      <div style={{ height: 12 }} />
      <label className="fld">Confidence bar: <b className="num">{Math.round(f.confidenceBar * 100)}%</b><input type="range" min={0.2} max={0.95} step={0.01} value={f.confidenceBar} onChange={(e) => set("confidenceBar", Number(e.target.value))} /><small>Ideas below this confidence are skipped.</small></label>
      <label className="fld">Max trades per cycle: <b className="num">{f.maxTradesPerCycle}</b><input type="range" min={1} max={5} step={1} value={f.maxTradesPerCycle} onChange={(e) => set("maxTradesPerCycle", Number(e.target.value))} /></label>
      <label className="fld">Trade size: <b className="num">${Math.round(f.tradeSizeUsd)}</b><input type="range" min={5} max={500} step={5} value={f.tradeSizeUsd} onChange={(e) => set("tradeSizeUsd", Number(e.target.value))} /></label>
      <div className="toggle"><div><b>Place real (testnet) orders</b><div className="small muted">Off means practice trades only.</div></div><button type="button" aria-pressed={f.realOrders} onClick={() => set("realOrders", !f.realOrders)}>{f.realOrders ? "On" : "Off"}</button></div>
      <div className="btns"><button className="primary" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save schedule and strategy"}</button></div>
      {msg && (msg.ok ? <div className="ok">{msg.t}</div> : <Err msg={msg.t} />)}
    </>
  );
}

export default function Cycles() {
  const { data: d, error, at, reload } = usePoll<any>("/api/cycles");
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const cs: any[] = d?.cycles ?? [];
  const asc = [...cs].reverse();
  let cum = 0, wins = 0, closed = 0;
  const cumPts = asc.map((c) => ({ x: c.n, y: (cum += c.pnl ?? 0) }));
  const hitPts = asc.map((c, i) => {
    const win = asc.slice(Math.max(0, i - 19), i + 1);
    const cl = win.reduce((a, r) => a + r.closed, 0), w = win.reduce((a, r) => a + r.wins, 0);
    return { x: c.n, y: cl ? (w / cl) * 100 : NaN };
  }).filter((p) => !Number.isNaN(p.y));
  asc.forEach((c) => { wins += c.wins; closed += c.closed; });
  let next = "-";
  if (d?.enabled === false) next = "automatic cycles are off";
  else if (cs[0]) { const s = (new Date(cs[0].started_at).getTime() + d.intervalSeconds * 1000 - Date.now()) / 1000; next = s > 0 ? `next cycle in about ${fmtDur(s)}` : "a cycle is due now"; }
  else next = "no cycles yet";
  return (
    <>
      <Title icon="cycle" at={at} error={error}>Cycles</Title>
      <Err msg={error && !d ? error : null} />
      <Card title="Schedule and strategy" icon="prefs" right={d && <span className="small muted">{d.enabled === false ? "off" : `every ${fmtDur(d.intervalSeconds)}`} · {next}</span>}>
        <Config onSaved={reload} />
      </Card>
      {!d ? <Loading /> : (
        <>
          <div className="grid">
            <div className="stat"><div className="lbl">Cycles shown</div><div className="val num">{cs.length}</div></div>
            <div className="stat"><div className="lbl">Cumulative PnL</div><div className={`val num ${cum >= 0 ? "pos" : "neg"}`}>{usd(cum)}</div></div>
            <div className="stat"><div className="lbl">Hit rate</div><div className="val num">{closed ? Math.round((wins / closed) * 100) + "%" : "-"}</div><div className="sub">{wins} of {closed} closed</div></div>
          </div>
          <Card title="Cumulative cycle PnL" icon="bars"><LineChart label="Cumulative PnL by live cycle" series={[{ name: "pnl", color: "var(--c1)", pts: cumPts }]} fmt={(n) => n.toFixed(2)} /></Card>
          <Card title="Rolling hit rate (20 cycles, %)" icon="approvals"><LineChart label="Rolling hit rate" zero={false} series={[{ name: "hit rate", color: "var(--c2)", pts: hitPts }]} fmt={(n) => Math.round(n) + "%"} /></Card>
          <Card title="Cycle ledger" icon="trace" right={<span className="muted">{cs.length}</span>}>
            {!cs.length ? <Empty icon="cycle" title="No cycles yet">Each automatic cycle will be listed here.</Empty> : (
              <div className="scroll"><table className="table"><thead><tr><th>#</th><th>When</th><th>News</th><th>New signals</th><th>Ideas</th><th>Proposed</th><th>Closed</th><th>Wins</th><th>PnL</th></tr></thead>
                <tbody>{cs.map((c) => <tr key={c.n}><td><b>{c.n}</b></td><td className="muted">{ago(c.started_at)}</td><td className="num">{c.signals_considered}</td><td className="num">{c.new_signals}</td><td className="num">{c.ideas}</td><td className="num">{c.proposed}</td><td className="num">{c.closed}</td><td className="num">{c.wins}</td><td className={`num ${(c.pnl ?? 0) >= 0 ? "pos" : "neg"}`}>{usd(c.pnl)}</td></tr>)}</tbody></table></div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
