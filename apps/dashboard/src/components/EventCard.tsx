"use client";
import Link from "next/link";
import { ago, host } from "@/components/ui";
import { kindOf, sentence, type Ev } from "@/lib/trace";

const safeUrl = (u: any) => typeof u === "string" && /^https?:\/\//.test(u);

export function Details({ e }: { e: Ev }) {
  const d = e.detail ?? {};
  const links: { title?: string; url: string }[] = [...(Array.isArray(d.sources) ? d.sources : []), ...(d.url ? [{ url: d.url, title: d.source_name }] : [])].filter((x: any) => safeUrl(x?.url));
  const rest = Object.entries(d).filter(([k, v]) => k !== "sources" && k !== "fixture" && typeof v !== "object" && v !== "" && v !== null);
  const objs = Object.entries(d).filter(([k, v]) => k !== "sources" && typeof v === "object" && v !== null && !Array.isArray(v));
  return (
    <div className="details">
      {links.length > 0 && <ul>{links.slice(0, 30).map((l, i) => <li key={i}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.title || host(l.url)}</a> <span className="muted">{host(l.url)}</span></li>)}</ul>}
      {(rest.length > 0 || objs.length > 0) && (
        <dl>{rest.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}
          {objs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{Object.entries(v as any).map(([a, b]) => `${a}: ${b}`).join(", ")}</dd></div>)}
          {Array.isArray(d.reasons) && <div><dt>reasons</dt><dd>{d.reasons.join("; ")}</dd></div>}</dl>
      )}
    </div>
  );
}

export default function EventCard({ e, link = true }: { e: Ev; link?: boolean }) {
  const k = kindOf(e.kind);
  return (
    <article className={`ev t-${k.tone}`}>
      <div className="ico" aria-hidden>{k.icon}</div>
      <div className="body">
        <div className="row"><span className="muted small">{k.label}</span><time className="muted small" title={new Date(e.ts).toLocaleString()}>{ago(e.ts)}</time></div>
        <div className="sent">{sentence(e)}</div>
        <details><summary>Details</summary><Details e={e} /></details>
        {link && e.thesis_id && <Link className="small" href={`/trace/${e.thesis_id}`}>Why this trade?</Link>}
      </div>
    </article>
  );
}
