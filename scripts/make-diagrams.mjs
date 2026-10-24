// Generates 5 judge-facing diagrams as .excalidraw + .svg (+ .png via headless Chrome).
// Usage: node scripts/make-diagrams.mjs [--refresh] [--no-png]
//   --refresh : re-query replay_cycles from the DB (needs DATABASE_URL, run with --env-file=.env)
// Chart data for image 5 is cached in docs/diagrams/replay-cum-pnl.json.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs/diagrams");
const W = 1600, H = 900;
const C = { ink: "#1e1e2e", indigo: "#6d5ef5", cyan: "#22b8cf", lav: "#eef0ff", sky: "#e3fafc", sand: "#fff4e6", rose: "#ffe3e3", mint: "#ebfbee",
  red: "#e03131", green: "#2f9e44", orange: "#f08c00", gray: "#868e96", white: "#ffffff" };
const FONT = "'Segoe Print','Comic Sans MS',cursive,sans-serif";
const SVG_FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";

// ---------- abstract spec builder ----------
function Spec(name, title, caption) {
  const els = [];
  const s = { name, els };
  s.rect = (x, y, w, h, o = {}) => els.push({ k: "rect", x, y, w, h, fill: o.fill ?? C.white, stroke: o.stroke ?? C.indigo, dashed: !!o.dashed, sw: o.sw ?? 2, r: o.r ?? true });
  s.ellipse = (x, y, w, h, o = {}) => els.push({ k: "ellipse", x, y, w, h, fill: o.fill ?? C.indigo, stroke: o.stroke ?? C.indigo });
  // text: x,y = top-left of the container; w = container width (for center/right align)
  s.text = (str, x, y, w, o = {}) => els.push({ k: "text", str, x, y, w, size: o.size ?? 22, color: o.color ?? C.ink, align: o.align ?? "center", bold: !!o.bold });
  s.arrow = (x1, y1, x2, y2, o = {}) => els.push({ k: "arrow", x1, y1, x2, y2, color: o.color ?? C.indigo, dashed: !!o.dashed, both: !!o.both });
  s.line = (pts, o = {}) => els.push({ k: "line", pts, color: o.color ?? C.ink, sw: o.sw ?? 2, dashed: !!o.dashed, fill: o.fill ?? null, closed: !!o.closed });
  // box with centered label (+ optional note)
  s.box = (x, y, w, h, label, o = {}) => {
    s.rect(x, y, w, h, o);
    const ls = o.size ?? 24, ns = o.noteSize ?? 18;
    const lh = label.split("\n").length * ls * 1.25;
    const nh = o.note ? o.note.split("\n").length * ns * 1.25 : 0;
    const gap = o.note ? 8 : 0;
    const top = y + (h - (lh + gap + nh)) / 2;
    s.text(label, x, top, w, { size: ls, bold: true, color: o.textColor ?? C.ink });
    if (o.note) s.text(o.note, x, top + lh + gap, w, { size: ns, color: o.noteColor ?? "#495057" });
  };
  // small label pill sitting on an arrow
  s.tag = (cx, cy, str, o = {}) => {
    const size = o.size ?? 18, w = Math.max(...str.split("\n").map((l) => l.length)) * size * 0.58 + 22, h = str.split("\n").length * size * 1.25 + 10;
    s.rect(cx - w / 2, cy - h / 2, w, h, { fill: C.white, stroke: o.stroke ?? "#ced4da", sw: 1 });
    s.text(str, cx - w / 2, cy - h / 2 + 5, w, { size, color: o.color ?? C.ink });
  };
  s.frame = () => {
    s.text(title, 0, 28, W, { size: 40, bold: true, color: C.indigo });
    s.text(caption, 0, 828, W, { size: 22, color: "#495057" });
  };
  return s;
}

// ---------- diagrams ----------
function d1() {
  const s = Spec("01-agent-overview");
  s.text("The agent in one picture", 0, 28, W, { size: 40, bold: true, color: C.indigo });
  const ag = { x: 650, y: 380, w: 300, h: 150 };
  s.box(ag.x, ag.y, ag.w, ag.h, "The Agent", { fill: C.indigo, stroke: C.indigo, textColor: "#fff", size: 34, note: "reads, thinks, proposes", noteColor: "#e5e1ff" });
  s.box(60, 130, 320, 100, "News", { fill: C.sky, stroke: C.cyan, note: "crypto headlines" });
  s.box(60, 385, 320, 100, "Your Preferences", { fill: C.sand, stroke: C.orange, note: "your style and limits" });
  s.box(60, 665, 320, 100, "Learning", { fill: C.mint, stroke: C.green, note: "results come back" });
  s.box(650, 115, 300, 100, "Trace", { fill: C.lav, stroke: C.indigo, note: "shows its work" });
  s.box(1220, 130, 320, 100, "Practice Money", { fill: C.lav, stroke: C.indigo, note: "pretend trades, live prices" });
  s.box(1220, 330, 320, 100, "Safety Rules", { fill: C.rose, stroke: C.red, note: "code the AI can't override" });
  s.box(1220, 520, 320, 100, "Practice Exchange", { fill: C.mint, stroke: C.green, note: "a real (test) trade" });
  s.box(650, 665, 300, 110, "You", { fill: C.sand, stroke: C.orange, note: "Approve / Reject / Rate" });
  s.arrow(380, 190, 650, 415, { color: C.cyan }); s.tag(500, 285, "signals");
  s.arrow(380, 435, 650, 455, { color: C.orange }); s.tag(515, 445, "your style");
  s.arrow(380, 705, 650, 505, { color: C.green }); s.tag(515, 610, "gets better");
  s.arrow(800, 380, 800, 215, { color: C.indigo }); s.tag(800, 297, "shows its work");
  s.arrow(950, 405, 1220, 195, { color: C.indigo }); s.tag(1085, 300, "try the idea");
  s.arrow(950, 455, 1220, 380, { color: C.red }); s.tag(1085, 418, "checks first");
  s.arrow(1380, 430, 1380, 520, { color: C.red }); s.tag(1380, 475, "real trade", { size: 16 });
  s.arrow(800, 530, 800, 665, { color: C.orange, both: true }); s.tag(800, 598, "asks, you answer");
  s.line([[1380, 620], [1380, 800], [220, 800]], { color: C.green, dashed: true, sw: 2.5 });
  s.arrow(220, 800, 220, 767, { color: C.green });
  s.tag(1000, 800, "results flow back to Learning", { size: 17, stroke: C.green });
  s.text("Practice money first. Real (test) trades only after the safety rules say yes.", 0, 828, W, { size: 22, color: "#495057" });
  return s;
}

function d2() {
  const s = Spec("02-life-of-a-trade");
  s.text("Life of one trade", 0, 28, W, { size: 40, bold: true, color: C.indigo });
  const steps = [
    ["News arrives", "from the web", C.sky, C.cyan], ["Signals found", "good or bad news", C.sky, C.cyan],
    ["Idea written", "what, how much, why", C.lav, C.indigo], ["Tried with\npretend money", "no risk", C.lav, C.indigo],
    ["Safety check", "rules in code", C.rose, C.red], ["Big? Ask you", "Approve or Reject", C.sand, C.orange],
    ["Trade placed", "on the test exchange", C.mint, C.green], ["Trade ends", "stop or target hit", C.mint, C.green],
    ["You rate it", "how did we do?", C.sand, C.orange], ["Agent learns", "trusts good sources more", C.mint, C.green],
  ];
  const bw = 230, bh = 170, gap = 80, x0 = 65, rows = [190, 520];
  const pos = (i) => { const r = i < 5 ? 0 : 1, c = i < 5 ? i : 9 - i; return { x: x0 + c * (bw + gap), y: rows[r] }; };
  steps.forEach(([l, n, f, st], i) => {
    const p = pos(i);
    s.box(p.x, p.y, bw, bh, l, { fill: f, stroke: st, size: 26, note: n, noteSize: 18 });
    s.ellipse(p.x - 14, p.y - 22, 44, 44, { fill: st, stroke: st });
    s.text(String(i + 1), p.x - 14, p.y - 22 + 8, 44, { size: 24, bold: true, color: "#fff" });
  });
  for (let i = 0; i < 9; i++) {
    const a = pos(i), b = pos(i + 1);
    if (i === 4) s.arrow(a.x + bw / 2, a.y + bh, b.x + bw / 2, b.y, { color: C.indigo });
    else if (i < 4) s.arrow(a.x + bw + 6, a.y + bh / 2, b.x - 6, b.y + bh / 2);
    else s.arrow(a.x - 6, a.y + bh / 2, b.x + bw + 6, b.y + bh / 2);
  }
  s.text("Safe, small trades skip step 6. Bigger or riskier ones always wait for you.", 0, 740, W, { size: 22, color: C.orange });
  s.text("Every step is recorded on the Trace page.", 0, 828, W, { size: 22, color: "#495057" });
  return s;
}

function d3() {
  const s = Spec("03-why-you-can-trust-it");
  s.text("Why you can trust it", 0, 28, W, { size: 40, bold: true, color: C.indigo });
  const cards = [
    ["You set the limits", "Your risk comfort,\nfavourite coins and the\nsize that needs your OK.", C.sand, C.orange],
    ["Hard safety rules", "Size, loss and exposure\nlimits written as code.\nThe AI cannot override.", C.rose, C.red],
    ["Everything is shown", "The Trace page tells\nthe story of every idea,\nstep by step.", C.lav, C.indigo],
    ["Emergency stop", "One button halts all\nnew trades right away.", C.rose, C.red],
  ];
  const cw = 340, ch = 520, gap = 40, x0 = (W - (4 * cw + 3 * gap)) / 2, y0 = 130;
  cards.forEach(([t, d, f, st], i) => {
    const x = x0 + i * (cw + gap);
    s.line([[x, y0], [x + cw, y0], [x + cw, y0 + ch * 0.62], [x + cw / 2, y0 + ch], [x, y0 + ch * 0.62], [x, y0]], { color: st, sw: 3, fill: f, closed: true });
    s.ellipse(x + cw / 2 - 28, y0 + 28, 56, 56, { fill: st, stroke: st });
    s.text(String(i + 1), x + cw / 2 - 28, y0 + 28 + 11, 56, { size: 28, bold: true, color: "#fff" });
    s.text(t, x, y0 + 120, cw, { size: 28, bold: true });
    s.text(d, x, y0 + 185, cw, { size: 22, color: "#495057" });
  });
  s.text("Practice money only. Nothing moves without passing the rules, and big trades wait for your Approve.", 0, 828, W, { size: 22, color: "#495057" });
  return s;
}

function d4() {
  const s = Spec("04-how-it-keeps-running");
  s.text("How it keeps running", 0, 28, W, { size: 40, bold: true, color: C.indigo });
  s.rect(60, 110, 820, 520, { fill: "#f8f9ff", stroke: C.indigo, dashed: true, sw: 3 });
  s.text("Freestyle cloud machine", 60, 128, 820, { size: 28, bold: true, color: C.indigo });
  s.box(100, 290, 300, 150, "Dashboard", { fill: C.sand, stroke: C.orange, note: "web + phone" });
  s.box(540, 290, 300, 150, "Agent worker", { fill: C.indigo, stroke: C.indigo, textColor: "#fff", note: "always on", noteColor: "#e5e1ff" });
  s.arrow(400, 365, 540, 365, { color: C.gray, both: true });
  s.text("One cloud computer,\nno laptop needed.", 440, 540, 420, { size: 18, color: "#495057" });
  const ext = [
    ["Supabase", "memory", C.sky, C.cyan, "stores everything"],
    ["Omnara", "approvals + the agent's brain", C.sand, C.orange, "approvals + brain"],
    ["context.dev", "reads the web", C.sky, C.cyan, "reads the web"],
    ["Claude", "reads and writes", C.lav, C.indigo, "reads + writes"],
    ["Binance testnet", "practice exchange", C.mint, C.green, "practice trades"],
  ];
  const ex = 1140, ew = 400, eh = 90, ys = [110, 240, 370, 500, 630];
  ext.forEach(([n, note, f, st, tag], i) => {
    s.box(ex, ys[i], ew, eh, n, { fill: f, stroke: st, note, size: 24 });
    const x1 = 840, y1 = [310, 340, 365, 390, 420][i], x2 = ex, y2 = ys[i] + eh / 2;
    s.arrow(x1, y1, x2, y2, { color: st === C.orange ? C.orange : st });
    const t = 0.6;
    s.tag(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, tag, { size: 17 });
  });
  s.box(140, 710, 400, 90, "You", { fill: C.sand, stroke: C.orange, note: "phone or browser" });
  s.arrow(250, 710, 250, 440, { color: C.orange, both: true });
  s.tag(250, 670, "approve, rate, watch", { size: 17 });
  s.text("Runs without the laptop", 0, 828, W, { size: 26, bold: true, color: C.indigo });
  return s;
}

function loadCycles() {
  const p = path.join(OUT, "replay-cum-pnl.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function d5() {
  const s = Spec("05-does-it-learn");
  s.text("Does it learn? The honest answer", 0, 28, W, { size: 40, bold: true, color: C.indigo });
  // left panel
  s.rect(60, 110, 700, 650, { fill: "#fbfbff", stroke: "#ced4da" });
  s.text("Can it tell good news from bad?", 60, 130, 700, { size: 28, bold: true });
  s.text("Yes. We planted sources we knew were good, random or backwards.", 60, 172, 700, { size: 18, color: "#495057" });
  const bars = [["Good source", 1.6, C.green], ["Random", 0.78, C.gray], ["Backwards", 0.3, C.red]];
  const base = 650, maxH = 340, bw2 = 140, bx0 = 130, bgap = 80;
  s.line([[bx0 - 30, base], [bx0 - 30 + 3 * bw2 + 2 * bgap + 60, base]], { color: C.ink });
  bars.forEach(([l, v, col], i) => {
    const h = (v / 1.6) * maxH, x = bx0 + i * (bw2 + bgap);
    s.rect(x, base - h, bw2, h, { fill: col, stroke: col, r: false });
    s.text(v.toFixed(2), x, base - h - 34, bw2, { size: 24, bold: true });
    s.text(l, x, base + 14, bw2, { size: 20 });
  });
  s.text("How much the agent learned to trust each source", 60, 700, 700, { size: 18, color: "#495057" });
  // right panel
  s.rect(820, 110, 720, 650, { fill: "#fbfbff", stroke: "#ced4da" });
  s.text("Profit over 100 rounds", 820, 130, 720, { size: 28, bold: true });
  s.text("Past prices, learner vs equal-weight baseline", 820, 172, 720, { size: 18, color: "#495057" });
  const rows = loadCycles();
  const arms = { learner: [], baseline: [] };
  for (const r of rows) arms[r.arm]?.push([Number(r.n), Number(r.cum_pnl)]);
  for (const a in arms) arms[a].sort((p, q) => p[0] - q[0]);
  const all = [...arms.learner, ...arms.baseline].map((p) => p[1]);
  const lo = Math.min(0, ...all), hi = Math.max(...all);
  const cx0 = 910, cx1 = 1440, cy0 = 270, cy1 = 620; // chart box
  const nmax = Math.max(...arms.learner.map((p) => p[0]), 1), nmin = Math.min(...arms.learner.map((p) => p[0]));
  const X = (n) => cx0 + ((n - nmin) / (nmax - nmin)) * (cx1 - cx0);
  const Y = (v) => cy1 - ((v - lo) / (hi - lo)) * (cy1 - cy0);
  s.line([[cx0, cy0 - 10], [cx0, cy1]], { color: C.ink });
  s.line([[cx0, Y(0)], [cx1, Y(0)]], { color: C.gray, dashed: true, sw: 1 });
  s.text("$0", 850, Y(0) - 12, 50, { size: 18, color: "#495057", align: "right" });
  const tickV = [50, 100].filter((v) => v < hi);
  tickV.forEach((v) => { s.line([[cx0, Y(v)], [cx1, Y(v)]], { color: "#dee2e6", sw: 1 }); s.text("$" + v, 850, Y(v) - 12, 50, { size: 18, color: "#495057", align: "right" }); });
  s.line(arms.baseline.map((p) => [X(p[0]), Y(p[1])]), { color: C.cyan, sw: 3 });
  s.line(arms.learner.map((p) => [X(p[0]), Y(p[1])]), { color: C.indigo, sw: 3 });
  s.text("round 1", cx0 - 30, cy1 + 12, 60, { size: 18, color: "#495057" });
  s.text("round 100", cx1 - 50, cy1 + 12, 100, { size: 18, color: "#495057" });
  const fl = arms.learner.at(-1)[1], fb = arms.baseline.at(-1)[1];
  s.text(`Learner: ends +$${Math.round(fl)}`, 930, 285, 300, { size: 22, bold: true, color: C.indigo, align: "left" });
  s.text(`Equal-weight: ends +$${Math.round(fb)}`, 930, 320, 320, { size: 22, bold: true, color: "#0b7285", align: "left" });
  s.rect(900, 660, 330, 46, { fill: C.sand, stroke: C.orange });
  s.text("within noise on real data", 900, 670, 330, { size: 22, bold: true, color: "#b35c00" });
  s.text("z = 1.43: not provably better than luck. With price-only\nsources the learner was $3 behind.", 900, 708, 620, { size: 18, color: "#495057", align: "left" });
  s.text("Replay on past prices, 100 rounds. Not live trading.", 0, 828, W, { size: 22, color: "#495057" });
  return s;
}

// ---------- emitters ----------
let idn = 0;
const rnd = () => Math.floor(Math.random() * 2 ** 31);
const textDims = (str, size) => { const ls = str.split("\n"); return { w: Math.max(...ls.map((l) => l.length)) * size * 0.6, h: ls.length * size * 1.25 }; };
function base(type, x, y, w, h, stroke, bg, extra = {}) {
  return { id: `${type}-${++idn}`, type, x, y, width: w, height: h, angle: 0, strokeColor: stroke, backgroundColor: bg, fillStyle: "solid", strokeWidth: 2,
    strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: rnd(), version: 1, versionNonce: rnd(),
    isDeleted: false, boundElements: null, updated: 1700000000000, link: null, locked: false, ...extra };
}
function toExcalidraw(spec) {
  idn = 0;
  const out = [];
  for (const e of spec.els) {
    if (e.k === "rect" || e.k === "ellipse") {
      out.push(base(e.k === "rect" ? "rectangle" : "ellipse", e.x, e.y, e.w, e.h, e.stroke, e.fill, { strokeWidth: e.sw ?? 2, strokeStyle: e.dashed ? "dashed" : "solid", roundness: e.k === "rect" ? (e.r ? { type: 3 } : null) : { type: 2 } }));
    } else if (e.k === "text") {
      const d = textDims(e.str, e.size);
      const w = e.align === "center" || e.align === "right" ? e.w : d.w;
      out.push(base("text", e.x, e.y, w, d.h, e.color, "transparent", { text: e.str, fontSize: e.size, fontFamily: 1, textAlign: e.align, verticalAlign: "top", containerId: null, originalText: e.str, lineHeight: 1.25, autoResize: true }));
    } else if (e.k === "arrow") {
      const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
      out.push(base("arrow", e.x1, e.y1, Math.abs(dx), Math.abs(dy), e.color, "transparent", { strokeStyle: e.dashed ? "dashed" : "solid", roundness: { type: 2 }, points: [[0, 0], [dx, dy]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: e.both ? "arrow" : null, endArrowhead: "arrow", elbowed: false }));
    } else if (e.k === "line") {
      const xs = e.pts.map((p) => p[0]), ys = e.pts.map((p) => p[1]), x0 = xs[0], y0 = ys[0];
      out.push(base("line", x0, y0, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), e.color, e.fill ?? "transparent", { strokeWidth: e.sw, strokeStyle: e.dashed ? "dashed" : "solid", roundness: null, points: e.pts.map((p) => [p[0] - x0, p[1] - y0]), lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: null }));
    }
  }
  return { type: "excalidraw", version: 2, source: "https://excalidraw.com", elements: out, appState: { viewBackgroundColor: "#ffffff", gridSize: null }, files: {} };
}
const REQ = ["id", "type", "x", "y", "width", "height", "angle", "strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity", "groupIds", "frameId", "roundness", "seed", "version", "versionNonce", "isDeleted", "boundElements", "updated", "link", "locked"];
function validate(doc, name) {
  if (doc.type !== "excalidraw" || doc.version !== 2 || !Array.isArray(doc.elements)) throw new Error(name + ": bad envelope");
  const ids = new Set();
  for (const el of doc.elements) {
    for (const k of REQ) if (!(k in el)) throw new Error(`${name}: ${el.id} missing ${k}`);
    if (ids.has(el.id)) throw new Error(`${name}: duplicate id ${el.id}`);
    ids.add(el.id);
    const need = el.type === "text" ? ["text", "fontSize", "fontFamily", "textAlign", "verticalAlign", "containerId", "originalText", "lineHeight", "autoResize"]
      : el.type === "arrow" ? ["points", "lastCommittedPoint", "startBinding", "endBinding", "startArrowhead", "endArrowhead", "elbowed"]
      : el.type === "line" ? ["points"] : [];
    for (const k of need) if (!(k in el)) throw new Error(`${name}: ${el.id} (${el.type}) missing ${k}`);
    for (const k of ["x", "y", "width", "height"]) if (!Number.isFinite(el[k])) throw new Error(`${name}: ${el.id} bad ${k}`);
  }
}
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function toSvg(spec) {
  const colors = [...new Set(spec.els.filter((e) => e.k === "arrow").map((e) => e.color))];
  const defs = colors.map((c) => `<marker id="h${c.slice(1)}" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1,1 L11,6 L1,11" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></marker>`).join("");
  let b = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs><rect width="${W}" height="${H}" fill="#ffffff"/>`;
  for (const e of spec.els) {
    if (e.k === "rect") b += `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.r ? 14 : 0}" fill="${e.fill}" stroke="${e.stroke}" stroke-width="${e.sw ?? 2}"${e.dashed ? ' stroke-dasharray="10 8"' : ""}/>`;
    else if (e.k === "ellipse") b += `<ellipse cx="${e.x + e.w / 2}" cy="${e.y + e.h / 2}" rx="${e.w / 2}" ry="${e.h / 2}" fill="${e.fill}" stroke="${e.stroke}" stroke-width="2"/>`;
    else if (e.k === "arrow") b += `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${e.color}" stroke-width="2.5" stroke-linecap="round"${e.dashed ? ' stroke-dasharray="9 7"' : ""} marker-end="url(#h${e.color.slice(1)})"${e.both ? ` marker-start="url(#h${e.color.slice(1)})"` : ""}/>`;
    else if (e.k === "line") b += `<polyline points="${e.pts.map((p) => p.map((v) => +v.toFixed(1)).join(",")).join(" ")}" fill="${e.fill ?? "none"}" stroke="${e.color}" stroke-width="${e.sw}" stroke-linejoin="round" stroke-linecap="round"${e.dashed ? ' stroke-dasharray="6 6"' : ""}/>`;
    else if (e.k === "text") {
      const anchor = e.align === "center" ? "middle" : e.align === "right" ? "end" : "start";
      const ax = e.align === "center" ? e.x + e.w / 2 : e.align === "right" ? e.x + e.w : e.x;
      e.str.split("\n").forEach((l, i) => { b += `<text x="${ax}" y="${(e.y + i * e.size * 1.25 + e.size * 0.95).toFixed(1)}" font-family="${SVG_FONT}" font-size="${e.size}" font-weight="${e.bold ? 700 : 400}" fill="${e.color}" text-anchor="${anchor}">${esc(l)}</text>`; });
    }
  }
  return b + "</svg>\n";
}

// ---------- main ----------
async function refresh() {
  const pg = (await import(path.join(ROOT, "node_modules/pg/lib/index.js"))).default;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(`select c.n, c.arm, c.cum_pnl from replay_cycles c where c.run_id = (select id from replay_runs where params->>'llm'='false' order by started_at desc limit 1) order by c.arm, c.n`);
  await c.end();
  fs.writeFileSync(path.join(OUT, "replay-cum-pnl.json"), JSON.stringify(r.rows));
  console.log("refreshed replay data:", r.rowCount, "rows");
}
if (process.argv.includes("--refresh")) await refresh();
fs.mkdirSync(OUT, { recursive: true });
for (const build of [d1, d2, d3, d4, d5]) {
  const spec = build();
  const doc = toExcalidraw(spec);
  validate(doc, spec.name);
  fs.writeFileSync(path.join(OUT, spec.name + ".excalidraw"), JSON.stringify(doc, null, 2));
  fs.writeFileSync(path.join(OUT, spec.name + ".svg"), toSvg(spec));
  if (!process.argv.includes("--no-png")) {
    try {
      const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"].find((c) => fs.existsSync(c));
      if (chrome) {
        execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1.5", `--window-size=${W},${H}`, `--screenshot=${path.join(OUT, spec.name + ".png")}`, "file://" + path.join(OUT, spec.name + ".svg")], { stdio: "ignore" });
      } else {
        execFileSync("qlmanage", ["-t", "-s", "1800", "-o", OUT, path.join(OUT, spec.name + ".svg")], { stdio: "ignore" });
        fs.renameSync(path.join(OUT, spec.name + ".svg.png"), path.join(OUT, spec.name + ".png"));
      }
    } catch (e) { console.warn("png render failed for", spec.name, e.message); }
  }
  console.log("ok", spec.name, doc.elements.length, "elements");
}
