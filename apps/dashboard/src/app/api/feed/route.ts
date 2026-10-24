import { q } from "@/lib/db";
import { handle, num } from "@/lib/http";
export const dynamic = "force-dynamic";
export function GET() {
  return handle(async () => {
    const [signals, theses] = await Promise.all([
      q(`select s.id,s.asset,s.direction,s.magnitude,s.horizon,s.confidence,s.url,s.created_at, so.url source
         from signals s left join sources so on so.id=s.source_id order by s.created_at desc limit 50`),
      q("select id,asset,direction,entry,size,stop,target,rationale,confidence,status,created_at from theses order by created_at desc limit 30"),
    ]);
    return {
      signals: signals.map((s) => ({ ...s, magnitude: num(s.magnitude), confidence: num(s.confidence) })),
      theses: theses.map((t) => ({ ...t, entry: num(t.entry), size: num(t.size), stop: num(t.stop), target: num(t.target), confidence: num(t.confidence) })),
    };
  });
}
