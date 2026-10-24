import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, safeEq, token } from "./lib/auth";

// Optional shared-secret gate: if DASHBOARD_PASSWORD is unset the app is open.
export async function proxy(req: NextRequest) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  const c = req.cookies.get(COOKIE)?.value ?? "";
  if (safeEq(c, await token(pw))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}
export const config = { matcher: ["/((?!_next/|icons/|favicon|sw.js|manifest.webmanifest).*)"] };
