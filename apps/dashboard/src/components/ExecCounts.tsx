export default function ExecCounts({ c, compact = false }: { c: any; compact?: boolean }) {
  const line = `So far: ${c.practice} practice trade${c.practice === 1 ? "" : "s"}, ${c.shorts} of them short${c.shorts === 1 ? "" : "s"} (practice-only because the test exchange is spot-only), ${c.longsWaiting} long${c.longsWaiting === 1 ? "" : "s"} waiting for a real fill.`;
  return <>{line}{!compact && " A long idea that passes the safety rules places both a practice and a real order; the comparison appears here as soon as one fills."}</>;
}
