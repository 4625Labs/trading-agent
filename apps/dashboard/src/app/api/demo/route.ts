import { q } from "@/lib/db";
import { HttpError, body, handle, num } from "@/lib/http";
import { RECENT_PENDING_SQL, validateCommand } from "@/lib/demo";
export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => {
    const [cmds, pos, pend, fb] = await Promise.all([
      q("select id,kind,payload,status,result,created_at,done_at from commands order by created_at desc limit 10"),
      q("select id,asset,direction,size,entry,stop,target from theses where status='executed' order by created_at desc limit 1"),
      q("select count(*)::int c from approvals where status='pending'"),
      q("select count(*)::int c from theses where status='closed' and feedback is null"),
    ]);
    const p = pos[0];
    return {
      commands: cmds,
      openPosition: p ? { ...p, size: num(p.size), entry: num(p.entry), stop: num(p.stop), target: num(p.target) } : null,
      pendingApprovals: pend[0].c,
      pendingFeedback: fb[0].c,
    };
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const c = validateCommand(await body(req));
    if (typeof c === "string") throw new HttpError(400, c);
    if ((await q(RECENT_PENDING_SQL, [c.kind])).length) throw new HttpError(429, "a command of this kind is already pending, try again in a few seconds");
    const r = await q("insert into commands(kind,payload) values ($1,$2::jsonb) returning id,kind,payload,status,result,created_at,done_at", [c.kind, JSON.stringify(c.payload)]);
    return { command: r[0] };
  });
}
