"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const items = [["/", "Overview"], ["/feed", "Feed"], ["/approvals", "Approvals"], ["/trace", "Trace"], ["/safety", "Safety"], ["/learning", "Learning"], ["/preferences", "Prefs"]];
export default function Nav() {
  const p = usePathname();
  if (p === "/login") return null;
  return (
    <nav className="nav" aria-label="Main">
      {items.map(([h, l]) => <Link key={h} href={h} aria-current={(h === "/" ? p === "/" : p.startsWith(h)) ? "page" : undefined}>{l}</Link>)}
    </nav>
  );
}
