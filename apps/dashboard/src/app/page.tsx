"use client";
import Chart from "@/components/Chart";
import { Badge, Card, Empty, Err, Loading, Poll, Stat, ago, pct, px, usePoll, usd } from "@/components/ui";

export default function Overview() {
  const { data: d, error, at } = usePoll<any>("/api/overview");
  const hb = d?.heartbeat;
  const runAge = hb?.lastRun ? (Date.now() - new Date(hb.lastRun.started_at).getTime()) / 1000 : null;
  const hl = hb?.health;
  const alive = hl ? hl.ok : runAge !== null ? runAge < 600 : null;
  return (
    <>
      <h1>Overview <Poll at={at} error={error} /></h1>
      <Err msg={error && !d ? error : null} />
      {!d ? <Loading /> : (
        <>
          {d.killSwitch && <div className="err"><b>Kill switch is ON.</b> The agent will not place any orders.</div>}
          <div className="grid">
            <Stat label="Worker" value={alive === null ? "Unknown" : alive ? "Alive" : "Down"} tone={alive === null ? "warn" : alive ? "pos" : "neg"}
              sub={hl ? `health check ${hl.ok ? "ok" : "failed"}` : hb?.lastRun ? `last run ${ago(hb.lastRun.started_at)} (${hb.lastRun.status ?? "?"})` : "no runs recorded"} />
            <Stat label="Wallet" value={usd(d.wallet.latest)} sub={d.wallet.at ? `snapshot ${ago(d.wallet.at)}` : "no snapshot yet"} />
            <Stat label="Synthetic PnL" value={usd(d.pnl.syntheticTotal)} tone={d.pnl.syntheticTotal >= 0 ? "pos" : "neg"} />
            <Stat label="Real PnL" value={usd(d.pnl.realTotal)} tone={d.pnl.realTotal >= 0 ? "pos" : "neg"} />
            <Stat label="Kill switch" value={d.killSwitch ? "ON" : "Off"} tone={d.killSwitch ? "neg" : "pos"} />
            <Stat label="Pending approvals" value={d.counts.pending} tone={d.counts.pending ? "warn" : undefined} sub={<a href="/approvals">review</a>} />
          </div>
          <Card title="Cumulative PnL (USD)">
            <Chart series={[{ name: "Synthetic", color: "var(--accent)", pts: d.pnl.synthetic }, { name: "Real", color: "var(--pos)", pts: d.pnl.real }]} />
          </Card>
          <Card title="Open positions" right={<span className="muted">{d.positions.length}</span>}>
            {!d.positions.length ? <Empty>No open positions.</Empty> : (
              <div className="scroll"><table className="table"><thead><tr><th>Asset</th><th>Side</th><th>Size</th><th>Fill</th><th>Stop</th><th>Target</th><th>Conf</th><th>Status</th></tr></thead>
                <tbody>{d.positions.map((p: any) => (
                  <tr key={p.id}><td><b>{p.asset}</b></td><td><Badge s={p.direction} /></td><td className="num">{usd(p.size)}</td><td className="num">{px(p.fill ?? p.entry)}</td><td className="num">{px(p.stop)}</td><td className="num">{px(p.target)}</td><td className="num">{pct(p.confidence)}</td><td><Badge s={p.status} /></td></tr>
                ))}</tbody></table></div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
