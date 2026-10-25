"use client";
import Icon from "./Icon";
import LineChart from "./LineChart";
import { Badge, Card, Empty, ago, pct, px, usd, usePoll } from "./ui";

export const MIN_CLOSED = 20;
export function ShadowStatus({ d }: { d: any }) {
  return d.minClosed < MIN_CLOSED
    ? <p className="small warn" style={{ margin: "0 0 10px" }}>Collecting data: {d.minClosed} of {MIN_CLOSED} closed trades per policy before any comparison is meaningful.</p>
    : <p className="small muted" style={{ margin: "0 0 10px" }}>Both policies have at least {MIN_CLOSED} closed trades. Differences can now be read cautiously; small samples are still noisy.</p>;
}

export function ShadowCompact() {
  const { data: d } = usePoll<any>("/api/shadow", 15000);
  if (!d) return <div className="sk" style={{ height: 56 }} />;
  const L = d.policies.learned, E = d.policies.equal;
  return (
    <>
      <ShadowStatus d={d} />
      <div className="levels" style={{ marginTop: 0 }}>
        <span>Learned <b>{usd(L.pnl)}</b> ({L.closed} closed)</span><span>Equal weights <b>{usd(E.pnl)}</b> ({E.closed} closed)</span>
      </div>
    </>
  );
}

export default function ShadowPanel() {
  const { data: d, error } = usePoll<any>("/api/shadow", 10000);
  if (!d) return <Card title="Live shadow test: learned vs equal weights" icon="learning">{error ? <div className="err">{error}</div> : <div className="sk" style={{ height: 160 }} />}</Card>;
  const P = [["learned", "Learned weights", "#a78bfa"], ["equal", "Equal weights", "#94a3b8"]] as const;
  const series = P.map(([k, name, color]) => ({ name, color, pts: d.policies[k].series.map((p: any, i: number) => ({ x: i + 1, y: p.v })) }));
  return (
    <>
      <Card title="Live shadow test: learned vs equal weights" icon="learning">
        <p className="muted small" style={{ marginTop: 0 }}>Two practice-only policies trade the same live signals. One uses the learned source weights, the other treats every source equally and never learns.</p>
        <ShadowStatus d={d} />
        <div className="grid">
          {P.map(([k, name]) => { const p = d.policies[k]; return (
            <div className="stat" key={k}><div className="lbl">{name}</div><div className={`val num ${p.pnl >= 0 ? "pos" : "neg"}`}>{usd(p.pnl)}</div>
              <div className="sub">{p.closed} closed · {p.wins} wins ({p.hitRate === null ? "-" : pct(p.hitRate)}) · {p.open} open · avg size {usd(p.avgSize, 0)}</div></div>
          ); })}
        </div>
        <LineChart label="Cumulative shadow PnL by trade close" series={series} area={false} fmt={(n) => n.toFixed(2)} />
        <div className="small muted">X axis counts closed trades per policy, in close order.</div>
      </Card>
      <Card title="Learned shadow weights" icon="feed">
        {!d.weights.length ? <Empty icon="feed" title="No weights yet">They appear once the shadow policy has evidence.</Empty> : (
          <div className="scroll"><table className="table"><thead><tr><th>Source</th><th>Weight</th><th>Hits</th><th>Trials</th></tr></thead>
            <tbody>{d.weights.map((w: any) => <tr key={w.source}><td>{w.source}</td><td className="num">{w.weight?.toFixed(2)}</td><td className="num">{w.hits}</td><td className="num">{w.trials}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card title="Recent shadow trades" icon="coins">
        {!d.recent.length ? <Empty icon="coins" title="No shadow trades yet" /> : (
          <div className="scroll"><table className="table"><thead><tr><th>Policy</th><th>Asset</th><th>Dir</th><th>Entry</th><th>Exit</th><th>PnL</th><th>Reason</th><th>When</th></tr></thead>
            <tbody>{d.recent.map((t: any) => <tr key={t.id}><td>{t.policy}</td><td><b>{t.asset}</b></td><td><Badge s={t.direction} /></td><td className="num">{px(t.entry)}</td><td className="num">{px(t.exit_price)}</td>
              <td className={`num ${(t.pnl ?? 0) >= 0 ? "pos" : "neg"}`}>{t.pnl === null ? (t.status === "open" ? "open" : "-") : usd(t.pnl)}</td><td>{t.exit_reason ?? "-"}</td><td className="muted">{ago(t.closed_at ?? t.opened_at)}</td></tr>)}</tbody></table></div>
        )}
      </Card>
    </>
  );
}
