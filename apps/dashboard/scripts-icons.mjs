// Generates PNG icons (no deps). Run: node scripts-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(n, path) {
  const px = Buffer.alloc(n * n * 4);
  const pts = [[0.2, 0.68], [0.38, 0.5], [0.52, 0.6], [0.8, 0.28]].map(([a, b]) => [a * n, b * n]);
  const dist = (x, y) => { let m = 1e9; for (let i = 0; i < pts.length - 1; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1]; const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); m = Math.min(m, Math.hypot(x - ax - t * dx, y - ay - t * dy)); } return m; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = dist(x + 0.5, y + 0.5), w = n * 0.045, a = Math.max(0, Math.min(1, w + 0.5 - d));
    const g = y / n; const bg = [11 + g * 8, 15 + g * 10, 20 + g * 14];
    const fg = [52, 211, 153];
    const o = (y * n + x) * 4;
    for (let i = 0; i < 3; i++) px[o + i] = Math.round(bg[i] * (1 - a) + fg[i] * a);
    px[o + 3] = 255;
  }
  const raw = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) { raw[y * (n * 4 + 1)] = 0; px.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
png(192, "public/icons/icon-192.png"); png(512, "public/icons/icon-512.png"); png(180, "public/icons/apple-touch-icon.png");
