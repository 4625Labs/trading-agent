// Test fixture: stands in for the worker (health port) under the same deploy path.
import { createServer } from "node:http";
const t = Date.now();
createServer((_, res) => res.end(JSON.stringify({ ok: true, who: "worker", pid: process.pid, uptimeS: Math.round((Date.now() - t) / 1000), v: process.env.FIXTURE_V ?? "1" })))
  .listen(Number(process.env.HEALTH_PORT ?? 8080), "0.0.0.0");
