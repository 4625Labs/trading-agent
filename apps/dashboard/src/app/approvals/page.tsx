"use client";
import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { Badge, Card, Empty, Err, Loading, Title, ago, pct, px, post, usd, usePoll } from "@/components/ui";

export default function Approvals() {
  const { data: d, error, at, reload } = usePoll<any>("/api/approvals");
  const fb = usePoll<any>("/api/feedback");
  const [sent, setSent] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function approve(thesisId: string, choice: string) {
    setBusy(thesisId); setErr(null);
    const r = await post("/api/approvals", { kind: "approval", thesisId, choice });
    setBusy(null);
    if (!r.ok) { setErr(r.error ?? "failed"); return; }
    setSent((s) => ({ ...s, [thesisId]: choice }));
    setTimeout(reload, 1500);
  }
  async function rate(thesisId: string, answer: string) {
    setBusy("fb" + thesisId); setErr(null);
    const r = await post("/api/feedback", { thesisId, answer });
    setBusy(null);
    if (!r.ok && !/already/.test(r.error ?? "")) { setErr(r.error ?? "failed"); return; }
    setSent((s) => ({ ...s, ["fb" + thesisId]: answer }));
    setTimeout(fb.reload, 1500);
  }

  return (
    <>
      <Title icon="approvals" at={at} error={error}>Approvals</Title>
      <Err msg={err ?? (error && !d ? error : null)} />
      {d?.omnaraError && <div className="err">Cannot reach Omnara: buttons may not work right now.</div>}
      {!d ? <Loading /> : (
        <>
          <Card title="Pending ideas" icon="hand" right={<span className="muted">{d.approvals.length}</span>}>
            {!d.approvals.length ? <Empty title="All caught up">Nothing is waiting for your approval.</Empty> : d.approvals.map((a: any) => {
              const s = sent[a.thesis_id];
              return (
                <div className="item" key={a.approval_id}>
                  <div className="row"><div><b>{a.asset}</b> <Badge s={a.direction} /> <span className="num">{usd(a.size)}</span></div><span className="muted small">{ago(a.requested_at)}</span></div>
                  <p>{a.rationale || "No rationale recorded."}</p>
                  <div className="levels"><span>Entry <b>{px(a.entry)}</b></span><span>Stop <b>{px(a.stop)}</b></span><span>Target <b>{px(a.target)}</b></span><span>Conf <b>{pct(a.confidence)}</b></span></div>
                  <Link className="tracelink" href={`/trace/${a.thesis_id}`}>Why this trade? <Icon name="arrow" size={12} /></Link>
                  {s ? <div className="ok">Sent ({s}), waiting for the worker to record it...</div> : (
                    <>
                      <div className="btns">
                        <button className="approve" disabled={busy === a.thesis_id} onClick={() => approve(a.thesis_id, "approve")}>Approve</button>
                        <button className="reject" disabled={busy === a.thesis_id} onClick={() => approve(a.thesis_id, "reject")}>Reject</button>
                      </div>
                      {!a.questionOpen && <p className="small muted">No open question found in Omnara for this idea yet; the click will report if it cannot be delivered.</p>}
                    </>
                  )}
                </div>
              );
            })}
          </Card>
          <Card title="How did we do?" icon="chat" right={<span className="muted">{fb.data?.items.length ?? 0}</span>}>
            {!fb.data ? <div className="sk" style={{ height: 90 }} /> : !fb.data.items.length ? <Empty icon="learning" title="No trades to rate">Closed trades that need your verdict appear here.</Empty> : fb.data.items.map((t: any) => {
              const s = sent["fb" + t.id]; const isSent = s || t.sent;
              return (
                <div className="item" key={t.id}>
                  <div className="row"><div><b>{t.asset}</b> <Badge s={t.direction} /> <Badge s="closed" /></div>
                    <span className={`num ${t.pnl >= 0 ? "pos" : "neg"}`}>{t.pnl === null ? "-" : usd(t.pnl)}</span></div>
                  <div className="small muted">Exit: {t.exit_reason ?? "unknown"} · {ago(t.closed_at)}</div>
                  {t.rationale && <p>{t.rationale}{t.rationale.length >= 220 ? "..." : ""}</p>}
                  <Link className="tracelink" href={`/trace/${t.id}`}>Why this trade? <Icon name="arrow" size={12} /></Link>
                  {isSent ? <div className="ok">Sent{s ? ` (${s})` : ""}, learning...</div> : (
                    <div className="btns fb-btns">{["Good call", "Bad call", "Too risky"].map((o) => (
                      <button key={o} className="big" disabled={busy === "fb" + t.id} onClick={() => rate(t.id, o)}>{o}</button>
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
