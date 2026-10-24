"use client";
import Link from "next/link";
import { use } from "react";
import { Details } from "@/components/EventCard";
import { Badge, Card, Err, Loading, Poll, ago, host, pct, px, usd, usePoll } from "@/components/ui";
import { sentence, type Ev } from "@/lib/trace";

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <section className="step"><div className="num-dot">{n}</div><div className="stepbody"><h2>{title}</h2>{children}</div></section>
);
const ok = (u: any) => typeof u === "string" && /^https?:\/\//.test(u);

export default function Why({ params }: { params: Promise<{ thesisId: string }> }) {
  const { thesisId } = use(params);
  const { data: d, error, at } = usePoll<any>(`/api/trace?thesis=${encodeURIComponent(thesisId)}`);
  const ev = (k: string): Ev[] => (d?.events ?? []).filter((e: Ev) => e.kind === k);
  const proposed = ev("thesis_proposed")[0];
  const guards = ev("guardrail");
  const decisions = [...ev("approval_requested"), ...ev("approval_decided"), ...ev("feedback")];
  const results = [...ev("order_executed"), ...ev("position_closed")];
  const ingestSources: any[] = d?.ingest?.detail?.sources ?? [];
  const t = d?.thesis;
  return (
    <>
      <h1>Why this trade? <Poll at={at} error={error} /></h1>
      <p><Link href="/trace">All activity</Link></p>
      <Err msg={error} />
      {!d ? (error ? null : <Loading />) : (
        <>
          <Card><div className="row"><div><b>{t.asset}</b> <Badge s={t.direction} /> <span className="num">{usd(t.size)}</span></div><Badge s={t.status ?? "open"} /></div>
            <div className="levels"><span>Entry <b>{px(t.entry)}</b></span><span>Stop <b>{px(t.stop)}</b></span><span>Target <b>{px(t.target)}</b></span><span>Conf <b>{pct(t.confidence)}</b></span></div></Card>
          <div className="chain">
            <Step n={1} title="News read">
              {d.signals.filter((s: any) => ok(s.url)).length === 0 && ingestSources.length === 0 ? <p className="muted">No articles linked.</p> : (
                <ul>{[...d.signals.filter((s: any) => ok(s.url)).map((s: any) => ({ url: s.url, title: host(s.source) || host(s.url) })), ...ingestSources.filter((s) => ok(s.url))].slice(0, 20).map((s: any, i: number) => <li key={i}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || host(s.url)}</a> <span className="muted">{host(s.url)}</span></li>)}</ul>
              )}
              {d.ingest && <p className="muted small">{sentence(d.ingest)} ({ago(d.ingest.ts)})</p>}
            </Step>
            <Step n={2} title="Signals found">
              {!d.signals.length ? <p className="muted">No linked signals.</p> : d.signals.map((s: any) => (
                <div className="item" key={s.id}><b>{s.asset}</b> <Badge s={s.direction ?? "n/a"} /> <span className="muted">{pct(s.confidence)} confident{s.horizon ? `, ${s.horizon}` : ""} · {host(s.source)}</span>
                  {ok(s.url) && <> · <a href={s.url} target="_blank" rel="noopener noreferrer">source</a></>}</div>
              ))}
            </Step>
            <Step n={3} title="Idea and reasoning">
              <p>{proposed ? sentence(proposed) : t.rationale || "No reasoning recorded."}</p>
              {proposed && t.rationale && <p className="muted">{t.rationale}</p>}
              {proposed && <details><summary>Details</summary><Details e={proposed} /></details>}
            </Step>
            <Step n={4} title="Safety rules checked">
              {!guards.length ? <p className="muted">No safety check recorded.</p> : guards.map((g) => <div className="item" key={g.id}>{sentence(g)}<div className="muted small">{ago(g.ts)}</div></div>)}
            </Step>
            <Step n={5} title="Your decision">
              {!decisions.length && !d.approvals.length ? <p className="muted">No decision needed or recorded.</p> : <>
                {decisions.map((e) => <div className="item" key={e.id}>{sentence(e)}<div className="muted small">{ago(e.ts)}</div></div>)}
                {!decisions.length && d.approvals.map((a: any, i: number) => <div className="item" key={i}>Approval {a.status}{a.feedback ? ` (${a.feedback})` : ""}</div>)}
              </>}
            </Step>
            <Step n={6} title="Result">
              {!results.length && !d.trades.length ? <p className="muted">No trade yet.</p> : <>
                {results.map((e) => <div className="item" key={e.id}>{sentence(e)}<div className="muted small">{ago(e.ts)}</div></div>)}
                {!results.length && d.trades.map((tr: any, i: number) => <div className="item" key={i}>{tr.venue} trade filled at {px(tr.fill_price)} (qty {tr.qty})</div>)}
              </>}
            </Step>
          </div>
        </>
      )}
    </>
  );
}
