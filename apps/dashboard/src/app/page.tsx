"use client";
import Chart from "@/components/Chart";
import Integrations from "@/components/Integrations";
import Icon from "@/components/Icon";
import Link from "next/link";
import { Badge, Card, Count, Empty, Err, Loading, Title, ago, pct, px, usePoll, usd } from "@/components/ui";

export default function Overview() {
  const { data: d, error, at } = usePoll<any>("/api/overview");
  const { data: u } = usePoll<any>("/api/usage", 15000);
  const hb = d?.heartbeat;
  const runAge = hb?.lastRun ? (Date.now() - new Date(hb.lastRun.started_at).getTime()) / 1000 : null;
  const hl = hb?.health;
  const alive = hl ? hl.ok : runAge !== null ? runAge < 600 : null;
  const sgn = (n: number) => (n >= 0 ? "pos" : "neg");
  return (
    <>
      <Title icon="overview" at={at} error={error}>Overview</Title>
      <Err msg={error && !d ? error : null} />
      {!d ? <Loading /> : (
        <>
          {d.killSwitch && <div className="err"><b>Kill switch is ON.</b> The agent will not place any orders. <Link href="/safety">Manage</Link></div>}
          <section className="hero" aria-label="Summary">
            <div className="top-line">
              <div className="hero-title"><Badge s={alive === null ? "waiting" : alive ? "alive" : "down"} />Agent {alive === null ? "status unknown" : alive ? "is running" : "is down"}
                <span className="muted small">{hl ? "health check " + (hl.ok ? "ok" : "failed") : hb?.lastRun ? `last run ${ago(hb.lastRun.started_at)}` : ""}</span></div>
              <Badge s={d.killSwitch ? "blocked" : "active"} />
            </div>
            <div className="hero-grid">
              <div><div className="lbl">Wallet</div><div className="big num"><Count value={d.wallet.latest} format={(n) => usd(n)} /></div><div className="sub">{d.wallet.at ? `snapshot ${ago(d.wallet.at)}` : "no snapshot yet"}</div></div>
              <div><div className="lbl">Practice PnL</div><div className={`big num ${sgn(d.pnl.syntheticTotal)}`}><Count value={d.pnl.syntheticTotal} format={(n) => usd(n)} /></div></div>
              <div><div className="lbl">Real PnL</div><div className={`big num ${sgn(d.pnl.realTotal)}`}><Count value={d.pnl.realTotal} format={(n) => usd(n)} /></div></div>
              <div><div className="lbl">Pending approvals</div><div className={`big num ${d.counts.pending ? "warn" : ""}`}><Count value={d.counts.pending} /></div><div className="sub"><Link href="/approvals">Review <Icon name="arrow" size={12} /></Link></div></div>
            </div>
          </section>
          <Card title="Integrations" icon="integrations" right={<Link className="small" href="/integrations">Details</Link>}>
            {u ? <Integrations usage={u} /> : <div className="sk" style={{ height: 120 }} />}
          </Card>
          <Card title="Cumulative PnL (USD)" icon="bars">
            <Chart series={[{ name: "Practice", color: "var(--c1)", pts: d.pnl.synthetic }, { name: "Real", color: "var(--c2)", pts: d.pnl.real }]} />
          </Card>
          <Card title="Open positions" icon="coins" right={<span className="muted">{d.positions.length}</span>}>
            {!d.positions.length ? <Empty title="No open positions">When the agent takes a trade it shows up here.</Empty> : (
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
