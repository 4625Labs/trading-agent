"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./Icon";
const items: [string, string, string][] = [["/", "Overview", "overview"], ["/feed", "Feed", "feed"], ["/approvals", "Approvals", "approvals"], ["/demo", "Demo", "demo"], ["/trace", "Trace", "trace"], ["/integrations", "Integrations", "integrations"], ["/safety", "Safety", "safety"], ["/learning", "Learning", "learning"], ["/preferences", "Prefs", "prefs"]];
export default function Nav() {
  const p = usePathname();
  if (p === "/login") return null;
  return (
    <header className="top">
      <div className="top-in">
        <Link href="/" className="brand"><span className="logo"><Icon name="logo" size={19} /></span><span>Trading <em>Agent</em></span></Link>
        <nav className="pills" aria-label="Main">
          {items.map(([h, l, i]) => <Link key={h} href={h} aria-current={(h === "/" ? p === "/" : p.startsWith(h)) ? "page" : undefined}><Icon name={i} size={16} />{l}</Link>)}
        </nav>
      </div>
    </header>
  );
}
