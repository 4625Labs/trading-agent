"use client";
import Link from "next/link";
import ExecCounts from "@/components/ExecCounts";
import Icon from "@/components/Icon";
import { Badge, Card, Count, Empty, Err, Loading, Title, ago, px, usd, usePoll } from "@/components/ui";

const bps = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(1)} bps`);

export default function Execution() {
  const { data: d, error, at } = usePoll<any>("/api/execution", 10000);
  const s = d?.summary, c = d?.counts, cal = d?.calibration;
  return (
    <>
      <Title icon="bars" at={at} error={error}>Sim vs real</Title>
      <Err msg={error && !d ? error : null} />
      {!d ? <Loading /> : (
        <>
          <div className="banner"><Icon name="info" size={18} /><div><b>Read this first:</b> Shorts have no real leg (spot-only testnet); demo-priced exits are excluded from the profit comparison; testnet order book is artificial.
            <div className="small muted" style={{ marginTop: 4 }}>Not compared: {c.shorts} shorts, {c.demoExits} demo-priced exits, {c.longsWaiting} longs waiting for a real fill.</div></div></div>
          {!s.entryN && <Card><Empty icon="coins" title="No real exchange trades yet"><ExecCounts c={c} /></Empty></Card>}
          <div className="grid">
            <div className="stat"><div className="lbl">Avg slippage gap</div><div className="val num">{bps(s.avgSlippageBps)}</div><div className="sub">real vs practice entry, {s.entryN} trade{s.entryN === 1 ? "" : "s"}</div></div>
            <div className="stat"><div className="lbl">Avg fee gap</div><div className="val num">{s.avgFeeGap === null ? "-" : usd(s.avgFeeGap, 4)}</div><div className="sub">based on {s.entryN} entr{s.entryN === 1 ? "y" : "ies"}</div></div>
            <div className="stat"><div className="lbl">Practice PnL</div><div className={`val num ${s.simPnl >= 0 ? "pos" : "neg"}`}>{s.exitN ? usd(s.simPnl) : "-"}</div><div className="sub">closed trades with both legs: {s.exitN}</div></div>
            <div className="stat"><div className="lbl">Real PnL</div><div className={`val num ${s.realPnl >= 0 ? "pos" : "neg"}`}>{s.exitN ? usd(s.realPnl) : "-"}</div><div className="sub">based on {s.exitN} trade{s.exitN === 1 ? "" : "s"}</div></div>
          </div>
          <Card title="Simulator calibration" icon="prefs">
            {!cal ? <Empty icon="cycle" title="No calibration yet">The simulator's fee and slippage settings are learned from real fills.</Empty> : (
              <div className="levels"><span>Slippage <b>{cal.slippage_bps.toFixed(1)} bps</b></span><span>Fee <b>{cal.fee_bps.toFixed(1)} bps</b></span><span>From <b>{cal.n_trades}</b> trades</span><span>{ago(cal.ts)}</span></div>
            )}
          </Card>
          <Card title="Entry fills (practice vs real)" icon="coins" right={<span className="muted">{d.entries.length}</span>}>
            <p className="small muted" style={{ marginTop: 0 }}>Includes open and demo-priced trades: entry fills and fees are real either way. Positive slippage means the real fill was worse.</p>
            {!d.entries.length ? <Empty icon="coins" title="No entry fills to compare yet"><ExecCounts c={c} compact /></Empty> : (
              <div className="scroll"><table className="table"><thead><tr><th>Asset</th><th>When</th><th>Practice fill</th><th>Real fill</th><th>Slippage</th><th>Fee gap</th><th>Size</th><th></th></tr></thead>
                <tbody>{d.entries.map((t: any) => (
                  <tr key={t.id}><td><b>{t.asset}</b> {t.demo && <span className="badge plain">demo</span>}</td><td className="muted">{ago(t.ts)}</td><td className="num">{px(t.simFill)}</td><td className="num">{px(t.realFill)}</td><td className="num">{bps(t.slippageBps)}</td><td className="num">{t.feeGap === null ? "-" : usd(t.feeGap, 4)}</td><td className="num">{usd(t.size)}</td><td><Link href={`/trace/${t.id}`}>trace</Link></td></tr>
                ))}</tbody></table></div>
            )}
          </Card>
          <Card title="Exit and profit gap" icon="flag" right={<span className="muted">{d.exits.length}</span>}>
            <p className="small muted" style={{ marginTop: 0 }}>Only closed, non-demo long trades with both legs.</p>
            {!d.exits.length ? <Empty icon="flag" title="No closed trades with both legs yet"><ExecCounts c={c} compact /></Empty> : (
              <div className="scroll"><table className="table"><thead><tr><th>Asset</th><th>Closed</th><th>Practice exit</th><th>Practice PnL</th><th>Real PnL</th><th>Gap</th><th></th></tr></thead>
                <tbody>{d.exits.map((t: any) => (
                  <tr key={t.id}><td><b>{t.asset}</b></td><td className="muted">{ago(t.closed_at)}</td><td className="num">{px(t.simExit)}</td><td className="num">{t.simPnl === null ? "-" : usd(t.simPnl)}</td><td className="num">{t.realPnl === null ? "-" : usd(t.realPnl)}</td>
                    <td className={`num ${t.pnlGap === null ? "" : t.pnlGap >= 0 ? "pos" : "neg"}`}>{t.pnlGap === null ? "-" : usd(t.pnlGap)}</td><td><Link href={`/trace/${t.id}`}>trace</Link></td></tr>
                ))}</tbody></table></div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
