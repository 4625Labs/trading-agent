"use client";
import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/Icon";
import { Badge, Card, Err, Loading, Title, ago, post, usd, usePoll } from "@/components/ui";

type Cmd = { id: string; kind: string; payload: any; status: string; result: string | null; created_at: string };
const latest = (cs: Cmd[], f: (c: Cmd) => boolean) => cs.find(f);
function State({ c }: { c?: Cmd }) {
  if (!c) return <Badge s="waiting" />;
  return <Badge s={c.status === "pending" ? "in progress" : c.status} />;
}
const Result = ({ c }: { c?: Cmd }) => (c?.result ? <p className="small muted">Result: {c.result}</p> : null);
const Step = ({ n, children }: { n: number; children: React.ReactNode }) => <section className="step"><div className="num-dot">{n}</div><div className="stepbody">{children}</div></section>;

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
  const move = latest(cs, (c) => c.kind === "demo_price_move");
  const inProg = (c?: Cmd) => c?.status === "pending";
  const pos = d?.openPosition;
  const blocked = (d?.pendingApprovals ?? 0) > 0;
  return (
    <>
      <Title icon="demo" at={at} error={error}>Demo</Title>
      <div className="banner"><Icon name="info" size={18} /><div><b>Demo mode:</b> price moves are simulated and labelled as such in the trace; practice money only.</div></div>
      <Err msg={err ?? (error && !d ? error : null)} />
      {!d ? <Loading /> : (
        <div className="chain">
          <Step n={1}>
            <div className="row"><h2>Propose a demo idea</h2><State c={idea} /></div>
            <button className="primary big" disabled={busy === "idea" || inProg(idea) || blocked} onClick={() => run("idea", { kind: "demo_idea" })}>Propose a demo idea</button>
            {blocked && <p className="small warn">Approve or reject the pending idea first (the agent handles one question at a time).</p>}
            <Result c={idea} />
          </Step>
          <Step n={2}>
            <div className="row"><h2>Approve it</h2><Badge s={d.pendingApprovals ? `${d.pendingApprovals} pending` : "waiting"} /></div>
            <Link className="btn big" href="/approvals">Open approvals</Link>
            <p className="small muted">{d.pendingApprovals ? `${d.pendingApprovals} waiting for you.` : "Nothing waiting yet. Propose an idea first."}</p>
          </Step>
          <Step n={3}>
            <div className="row"><h2>Move the price</h2><State c={move} /></div>
            {pos ? <p className="small muted">Open position: {pos.direction} {pos.asset} {usd(pos.size)} (stop {pos.stop}, target {pos.target})</p> : <p className="small muted">Needs an open position. Approve an idea first.</p>}
            <div className="btns">
              <button className="approve big" disabled={!pos || busy === "t" || inProg(move)} onClick={() => run("t", { kind: "demo_price_move", payload: { outcome: "target" } })}>Simulate price hits target</button>
              <button className="reject big" disabled={!pos || busy === "s" || inProg(move)} onClick={() => run("s", { kind: "demo_price_move", payload: { outcome: "stop" } })}>Simulate price hits stop</button>
            </div>
            <Result c={move} />
          </Step>
          <Step n={4}>
            <div className="row"><h2>Give feedback</h2><Badge s={d.pendingFeedback ? `${d.pendingFeedback} pending` : "waiting"} /></div>
            <Link className="btn big" href="/approvals">Rate closed trades</Link>
            <p className="small muted">{d.pendingFeedback ? `${d.pendingFeedback} closed trade${d.pendingFeedback === 1 ? "" : "s"} waiting for your verdict.` : "Close a trade first, then rate it under How did we do?"}</p>
          </Step>
          <Step n={5}>
            <h2>See what it learned</h2>
            <div className="btns"><Link className="btn big" href="/learning">Learning</Link><Link className="btn big" href="/trace">Open the trace</Link></div>
          </Step>
        </div>
      )}
      {d && <Card title="Recent commands" icon="trace">
        {!cs.length ? <p className="muted">None yet.</p> : cs.map((c) => (
          <div className="item" key={c.id}><div className="row"><span>{c.kind}{c.payload?.outcome ? ` (${c.payload.outcome})` : ""}</span><Badge s={c.status} /></div>
            <div className="small muted">{ago(c.created_at)}{c.result ? ` · ${c.result}` : ""}</div></div>
        ))}
      </Card>}
    </>
  );
}
