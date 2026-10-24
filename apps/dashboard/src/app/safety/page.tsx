"use client";
import { useState } from "react";
import { Badge, Card, Empty, Err, Loading, Poll, ago, post, usePoll } from "@/components/ui";

export default function Safety() {
  const { data: d, error, at, reload } = usePoll<any>("/api/safety");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function toggle(on: boolean) {
    if (on && !confirm("Turn the kill switch ON? The agent will stop placing orders.")) return;
    setBusy(true); setErr(null);
    const r = await post("/api/safety", { killSwitch: on });
    setBusy(false);
    if (!r.ok) setErr(r.error ?? "failed");
    reload();
  }
  return (
    <>
      <h1>Safety <Poll at={at} error={error} /></h1>
      <Err msg={err ?? (error && !d ? error : null)} />
      {!d ? <Loading /> : (
        <>
          <section className={`card ${d.killSwitch ? "ks-on" : ""}`}>
            <div className="switch">
              <div><h2>Kill switch</h2><div style={{ fontSize: "1.3rem", fontWeight: 650 }} className={d.killSwitch ? "neg" : "pos"}>{d.killSwitch ? "ON: trading halted" : "Off: trading allowed"}</div></div>
              <button className={d.killSwitch ? "approve" : "danger"} disabled={busy} onClick={() => toggle(!d.killSwitch)}>{d.killSwitch ? "Resume trading" : "Halt trading"}</button>
            </div>
          </section>
          <Card title="Guardrail events" right={<span className="muted">{d.events.length}</span>}>
            {!d.events.length ? <Empty>No guardrail decisions logged yet.</Empty> : (
              <div className="scroll"><table className="table"><thead><tr><th>When</th><th>Asset</th><th>Verdict</th><th>Reasons</th></tr></thead>
                <tbody>{d.events.map((e: any) => (
                  <tr key={e.id}><td className="muted">{ago(e.created_at)}</td><td>{e.asset ?? "-"}</td><td><Badge s={e.verdict} /></td><td>{(e.reasons ?? []).join("; ") || "-"}</td></tr>
                ))}</tbody></table></div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
