"use client";
import { Badge, Card, Count, Empty, Err, Loading, Title, ago, px, usd, usePoll } from "@/components/ui";
import Icon from "@/components/Icon";
import Link from "next/link";

const bps = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(1)} bps`);

export default function Execution() {
  const { data: d, error, at } = usePoll<any>("/api/execution", 10000);
  const s = d?.summary, x = d?.excluded, cal = d?.calibration;
  return (
    <>
      <Title icon="bars" at={at} error={error}>Sim vs real</Title>
      <Err msg={error && !d ? error : null} />
      {!d ? <Loading /> : (
        <>
          <div className="banner"><Icon name="info" size={18} /><div><b>Read this first:</b> Shorts have no real leg (spot-only testnet); demo-priced trades are excluded; testnet order book is artificial.
            <div className="small muted" style={{ marginTop: 4 }}>Excluded from {x.closed} closed trades: {x.shorts} shorts, {x.demo} demo-priced, {x.noRealLeg} long trades without a real fill.</div></div></div>
          <div className="grid">
            <div className="stat"><div className="lbl">Trades compared</div><div className="val num"><Count value={s.n} /></div></div>
            <div className="stat"><div className="lbl">Avg slippage gap</div><div className="val num">{bps(s.avgSlippageBps)}</div><div className="sub">real vs sim fill</div></div>
            <div className="stat"><div className="lbl">Avg fee gap</div><div className="val num">{s.avgFeeGap === null ? "-" : usd(s.avgFeeGap, 4)}</div></div>
            <div className="stat"><div className="lbl">Sim PnL</div><div className={`val num ${s.simPnl >= 0 ? "pos" : "neg"}`}>{usd(s.simPnl)}</div></div>
            <div className="stat"><div className="lbl">Real PnL</div><div className={`val num ${s.realPnl >= 0 ? "pos" : "neg"}`}>{usd(s.realPnl)}</div></div>
          </div>
          <Card title="Simulator calibration" icon="prefs">
            {!cal ? <Empty icon="cycle" title="No calibration yet">The simulator's fee and slippage settings are learned from real fills.</Empty> : (
              <div className="levels"><span>Slippage <b>{cal.slippage_bps.toFixed(1)} bps</b></span><span>Fee <b>{cal.fee_bps.toFixed(1)} bps</b></span><span>From <b>{cal.n_trades}</b> trades</span><span>{ago(cal.ts)}</span></div>
            )}
          </Card>
          <Card title="Per-trade comparison" icon="coins" right={<span className="muted">{d.trades.length}</span>}>
            {!d.trades.length ? <Empty icon="coins" title="No comparable trades yet">Closed long trades with both a practice and a real fill appear here.</Empty> : (
              <div className="scroll"><table className="table"><thead><tr><th>Asset</th><th>Sim fill</th><th>Real fill</th><th>Slippage</th><th>Fee gap</th><th>Sim PnL</th><th>Real PnL</th><th>Gap</th><th></th></tr></thead>
                <tbody>{d.trades.map((t: any) => (
                  <tr key={t.id}><td><b>{t.asset}</b></td><td className="num">{px(t.simFill)}</td><td className="num">{px(t.realFill)}</td><td className="num">{bps(t.slippageBps)}</td><td className="num">{t.feeGap === null ? "-" : usd(t.feeGap, 4)}</td>
                    <td className="num">{t.simPnl === null ? "-" : usd(t.simPnl)}</td><td className="num">{t.realPnl === null ? "-" : usd(t.realPnl)}</td>
                    <td className={`num ${t.pnlGap === null ? "" : t.pnlGap >= 0 ? "pos" : "neg"}`}>{t.pnlGap === null ? "-" : usd(t.pnlGap)}</td><td><Link href={`/trace/${t.id}`}>trace</Link></td></tr>
                ))}</tbody></table></div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
