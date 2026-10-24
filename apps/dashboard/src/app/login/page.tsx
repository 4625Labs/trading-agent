"use client";
import { useState } from "react";
import Icon from "@/components/Icon";
import { Card, Err, post } from "@/components/ui";
export default function Login() {
  const [pw, setPw] = useState(""); const [err, setErr] = useState<string | null>(null);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    const r = await post("/api/login", { password: pw });
    if (r.ok) window.location.href = "/"; else setErr(r.error ?? "failed");
  }
  return (
    <div className="login"><div className="login-logo"><span className="logo"><Icon name="logo" size={30} /></span>Trading Agent</div><Card>
      <form className="f" onSubmit={go}>
        <label className="fld">Password<input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>
        <button className="primary">Sign in</button><Err msg={err} />
      </form></Card></div>
  );
}
