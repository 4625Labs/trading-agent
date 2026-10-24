"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Card, Err, Loading, Poll, ago, post, usd, usePoll } from "@/components/ui";

type Cmd = { id: string; kind: string; payload: any; status: string; result: string | null; created_at: string };
const latest = (cs: Cmd[], f: (c: Cmd) => boolean) => cs.find(f);

function State({ c }: { c?: Cmd }) {
  if (!c) return <Badge s="waiting" />;
  return <Badge s={c.status === "pending" ? "in progress" : c.status === "done" ? "done" : c.status} />;
}
const Result = ({ c }: { c?: Cmd }) => (c?.result ? <p className="small muted">Result: {c.result}</p> : null);

export default function Demo() {
  const { data: d, error, at, reload } = usePoll<any>("/api/demo", 3000);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run(key: string, b: unknown) {
    setBusy(key); setErr(null);
    const r = await post("/api/demo", b);
    setBusy(null);
    if (!r.ok) setErr(r.error ?? "failed");
    reload();
  }
  const cs: Cmd[] = d?.commands ?? [];
  const idea = latest(cs, (c) => c.kind === "demo_idea");
  const target = latest(cs, (c) => c.kind === "demo_price_move" && c.payload?.outcome === "target");
  const stop = latest(cs, (c) => c.kind === "demo_price_move" && c.payload?.outcome === "stop");
  const move = latest(cs, (c) => c.kind === "demo_price_move");
  const inProg = (c?: Cmd) => c?.status === "pending";
  const pos = d?.openPosition;
  return (
    <>
      <h1>Demo <Poll at={at} error={error} /></h1>
      <div className="ok" style={{ marginTop: 0 }}><b>Demo mode:</b> price moves are simulated and labelled as such in the trace; practice money only.</div>
      <Err msg={err ?? (error && !d ? error : null)} />
      {!d ? <Loading /> : (
        <div className="chain">
          <section className="step"><div className="num-dot">1</div><div className="stepbody">
            <div className="row"><h2>Propose a demo idea</h2><State c={idea} /></div>
            <button className="primary big" disabled={busy === "idea" || inProg(idea)} onClick={() => run("idea", { kind: "demo_idea" })}>Propose a demo idea</button>
            <Result c={idea} />
          </div></section>
          <section className="step"><div className="num-dot">2</div><div className="stepbody">
            <div className="row"><h2>Approve it</h2><Badge s={d.pendingApprovals ? `${d.pendingApprovals} pending` : "waiting"} /></div>
            <Link className="btn big" href="/approvals">Open approvals</Link>
            <p className="small muted">{d.pendingApprovals ? `${d.pendingApprovals} waiting for you.` : "Nothing waiting yet. Propose an idea first."}</p>
          </div></section>
          <section className="step"><div className="num-dot">3</div><div className="stepbody">
            <div className="row"><h2>Move the price</h2><State c={move} /></div>
            {pos ? <p className="small muted">Open position: {pos.direction} {pos.asset} {usd(pos.size)} (stop {pos.stop}, target {pos.target})</p> : <p className="small muted">Needs an open position. Approve an idea first.</p>}
            <div className="btns">
              <button className="approve big" disabled={!pos || busy === "t" || inProg(move)} onClick={() => run("t", { kind: "demo_price_move", payload: { outcome: "target" } })}>Simulate price hits target</button>
              <button className="reject big" disabled={!pos || busy === "s" || inProg(move)} onClick={() => run("s", { kind: "demo_price_move", payload: { outcome: "stop" } })}>Simulate price hits stop</button>
            </div>
            <Result c={move} />
            {target && stop && <p className="small muted">Both outcomes have been tried.</p>}
          </div></section>
          <section className="step"><div className="num-dot">4</div><div className="stepbody">
            <div className="row"><h2>Give feedback</h2><Badge s={d.pendingFeedback ? `${d.pendingFeedback} pending` : "waiting"} /></div>
            <Link className="btn big" href="/approvals">Open feedback</Link>
          </div></section>
          <section className="step"><div className="num-dot">5</div><div className="stepbody">
            <h2>See what it learned</h2>
            <div className="btns"><Link className="btn big" href="/learning">Learning</Link><Link className="btn big" href="/trace">Open the trace</Link></div>
          </div></section>
        </div>
      )}
      {d && <Card title="Recent commands">
        {!cs.length ? <p className="muted">None yet.</p> : cs.map((c) => (
          <div className="item" key={c.id}><div className="row"><span>{c.kind}{c.payload?.outcome ? ` (${c.payload.outcome})` : ""}</span><Badge s={c.status} /></div>
            <div className="small muted">{ago(c.created_at)}{c.result ? ` · ${c.result}` : ""}</div></div>
        ))}
      </Card>}
    </>
  );
}
