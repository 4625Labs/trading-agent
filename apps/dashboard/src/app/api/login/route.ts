import { NextResponse } from "next/server";
import { COOKIE, safeEq, token } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return NextResponse.json({ ok: true });
  const b = await req.json().catch(() => ({}));
  if (typeof b?.password !== "string" || !safeEq(await token(b.password), await token(pw))) return NextResponse.json({ error: "wrong password" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await token(pw), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.COOKIE_INSECURE !== "1", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
