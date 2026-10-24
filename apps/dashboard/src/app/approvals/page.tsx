"use client";
import { useState } from "react";
import { Badge, Card, Empty, Err, Loading, Poll, ago, pct, px, post, usd, usePoll } from "@/components/ui";

type Sent = Record<string, string>;

export default function Approvals() {
  const { data: d, error, at, reload } = usePoll<any>("/api/approvals");
  const [sent, setSent] = useState<Sent>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(kind: "approval" | "feedback", thesisId: string, choice: string) {
    const key = kind + thesisId;
    setBusy(key); setErr(null);
    const r = await post("/api/approvals", { kind, thesisId, choice });
    setBusy(null);
    if (!r.ok) { setErr(r.error ?? "failed"); return; }
    setSent((s) => ({ ...s, [key]: choice }));
    setTimeout(reload, 1500);
  }

  return (
    <>
      <h1>Approvals <Poll at={at} error={error} /></h1>
      <Err msg={err ?? (error && !d ? error : null)} />
      {d?.omnaraError && <div className="err">Cannot reach Omnara: buttons may not work right now.</div>}
      {!d ? <Loading /> : (
        <>
          <Card title="Pending approvals" right={<span className="muted">{d.approvals.length}</span>}>
            {!d.approvals.length ? <Empty>Nothing waiting for you.</Empty> : d.approvals.map((a: any) => {
              const key = "approval" + a.thesis_id; const s = sent[key];
              return (
                <div className="item" key={a.approval_id}>
                  <div className="row"><div><b>{a.asset}</b> <Badge s={a.direction} /> <span className="num">{usd(a.size)}</span></div><span className="muted">{ago(a.requested_at)}</span></div>
                  <p>{a.rationale || "No rationale recorded."}</p>
                  <div className="levels"><span>Entry <b>{px(a.entry)}</b></span><span>Stop <b>{px(a.stop)}</b></span><span>Target <b>{px(a.target)}</b></span><span>Conf <b>{pct(a.confidence)}</b></span></div>
                  <a className="tracelink" href={`/trace/${a.thesis_id}`}>Why this trade?</a>
                  {s ? <div className="ok">Sent ({s}), waiting for worker to record it...</div> : (
                    <>
                      <div className="btns">
                        <button className="approve" disabled={busy === key} onClick={() => act("approval", a.thesis_id, "approve")}>Approve</button>
                        <button className="reject" disabled={busy === key} onClick={() => act("approval", a.thesis_id, "reject")}>Reject</button>
                      </div>
                      {!a.questionOpen && <p className="muted">No open question found in Omnara for this thesis yet; the click will report if it cannot be delivered.</p>}
                    </>
                  )}
                </div>
              );
            })}
          </Card>
          <Card title="Feedback requests" right={<span className="muted">{d.feedback.length}</span>}>
            {!d.feedback.length ? <Empty>No feedback questions open.</Empty> : d.feedback.map((f: any) => {
              const key = "feedback" + f.thesisId; const s = sent[key];
              return (
                <div className="item" key={f.thesisId}>
                  <div><b>{f.asset ?? "Thesis"}</b> <span className="muted">{f.thesisId.slice(0, 8)}</span></div>
                  <p>{f.prompt}</p>
                  {s ? <div className="ok">Sent ({s}).</div> : (
                    <div className="btns">{["Good call", "Bad call", "Too risky"].filter((o) => f.options.includes(o)).map((o) => (
                      <button key={o} disabled={busy === key} onClick={() => act("feedback", f.thesisId, o)}>{o}</button>
                    ))}</div>
                  )}
                </div>
              );
            })}
          </Card>
        </>
      )}
    </>
  );
}
