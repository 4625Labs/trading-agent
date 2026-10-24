// Lists Omnara project ids and secret names/ids (metadata only; values are never returned by the API).
const H = { Authorization: `Bearer ${process.env.OMNARA_ADMIN_TOKEN}` };
const B = "https://api.omnara.com/v1";
const j = async (p) => { const r = await fetch(B + p, { headers: H }); return [r.status, r.ok ? await r.json() : null]; };
const [, orgs] = await j("/orgs"); const org = (orgs.data ?? orgs)[0].id;
for (const p of [`/orgs/${org}/projects`, `/orgs/${org}/secrets`]) {
  const [s, b] = await j(p); const l = b?.data ?? b;
  console.log(p.split("/").pop(), s, Array.isArray(l) ? l.map((x) => `${x.id}:${x.name ?? ""}`).join(" | ") || "(none)" : "?");
}
