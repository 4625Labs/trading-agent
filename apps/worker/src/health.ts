// Dependency-free health endpoint (node:http; works under node and bun).
import { createServer, type Server } from "node:http";

export const heartbeat = {
  startedAt: Date.now(),
  lastTickAt: null as number | null,
  lastIngestAt: null as number | null,
  agents: 0,
  tick(): void { this.lastTickAt = Date.now(); },
  ingest(): void { this.lastIngestAt = Date.now(); },
};

export interface HealthStatus {
  lastTickAt?: number | null;
  lastIngestAt?: number | null;
  agents?: number;
  ok?: boolean;
  [k: string]: unknown;
}

export function startHealthServer(opts: { port: number; getStatus?: () => HealthStatus; host?: string }): Promise<Server> {
  const started = Date.now();
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method !== "GET" || (path !== "/health" && path !== "/")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"error":"not found"}');
      return;
    }
    let s: HealthStatus = {};
    try { s = opts.getStatus ? opts.getStatus() : {}; } catch { s = { ok: false }; }
    const body = {
      ok: s.ok ?? true,
      uptimeS: Math.round((Date.now() - started) / 1000),
      lastTickAt: s.lastTickAt ?? null,
      lastIngestAt: s.lastIngestAt ?? null,
      agents: s.agents ?? 0,
      version: process.env.APP_VERSION ?? "dev",
    };
    res.writeHead(body.ok ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host ?? "0.0.0.0", () => resolve(server));
  });
}
