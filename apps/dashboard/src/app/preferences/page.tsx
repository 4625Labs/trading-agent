"use client";
import { useEffect, useState } from "react";
import { Card, Err, Loading, post } from "@/components/ui";

export default function Prefs() {
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/prefs", { cache: "no-store" }).then((r) => r.json()).then((p) => setF({
      allowedAssets: (p.allowedAssets ?? []).join(", "), bannedAssets: (p.bannedAssets ?? []).join(", "),
      maxPositionPct: String(p.maxPositionPct * 100), approvalThresholdUsd: String(p.approvalThresholdUsd), minConfidence: String(p.minConfidence),
    })).catch(() => setMsg({ ok: false, t: "could not load preferences" }));
  }, []);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f!, [k]: e.target.value });
  const list = (s: string) => s.split(/[\s,]+/).filter(Boolean);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await post("/api/prefs", { allowedAssets: list(f!.allowedAssets), bannedAssets: list(f!.bannedAssets), maxPositionPct: Number(f!.maxPositionPct) / 100, approvalThresholdUsd: Number(f!.approvalThresholdUsd), minConfidence: Number(f!.minConfidence) });
    setBusy(false);
    setMsg(r.ok ? { ok: true, t: "Saved. The worker picks this up on its next order." } : { ok: false, t: r.error ?? "failed" });
  }
  return (
    <>
      <h1>Preferences</h1>
      {!f ? (msg ? <Err msg={msg.t} /> : <Loading />) : (
        <Card>
          <form className="f" onSubmit={save}>
            <label className="fld">Allowed assets<small>Comma separated symbols, e.g. BTC, ETH, SOL</small><input type="text" value={f.allowedAssets} onChange={set("allowedAssets")} autoCapitalize="characters" /></label>
            <label className="fld">Banned assets<small>Never trade these</small><input type="text" value={f.bannedAssets} onChange={set("bannedAssets")} autoCapitalize="characters" /></label>
            <label className="fld">Max position size (% of wallet)<small>0 to 100</small><input type="number" step="any" inputMode="decimal" min={0} max={100} value={f.maxPositionPct} onChange={set("maxPositionPct")} /></label>
            <label className="fld">Approval threshold (USD)<small>Orders above this need your approval</small><input type="number" step="any" inputMode="decimal" min={0} value={f.approvalThresholdUsd} onChange={set("approvalThresholdUsd")} /></label>
            <label className="fld">Minimum confidence<small>0 to 1; below this needs your approval</small><input type="number" step="any" inputMode="decimal" min={0} max={1} value={f.minConfidence} onChange={set("minConfidence")} /></label>
            <button className="primary" disabled={busy}>{busy ? "Saving..." : "Save preferences"}</button>
            {msg && (msg.ok ? <div className="ok">{msg.t}</div> : <Err msg={msg.t} />)}
          </form>
        </Card>
      )}
    </>
  );
}
