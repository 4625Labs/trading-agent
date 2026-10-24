import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { startHealthServer, heartbeat } from "../src/health.ts";

test("health endpoint reports status and 404s elsewhere", async () => {
  heartbeat.agents = 2;
  heartbeat.tick();
  const server = await startHealthServer({ port: 0, host: "127.0.0.1", getStatus: () => ({ lastTickAt: heartbeat.lastTickAt, lastIngestAt: heartbeat.lastIngestAt, agents: heartbeat.agents }) });
  const port = (server.address() as AddressInfo).port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(r.status, 200);
    const j = await r.json() as any;
    assert.equal(j.ok, true);
    assert.equal(j.agents, 2);
    assert.equal(typeof j.lastTickAt, "number");
    assert.equal(j.lastIngestAt, null);
    assert.equal(typeof j.uptimeS, "number");
    assert.ok(j.version);
    assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404);
  } finally { server.close(); }
});

test("ok:false yields 503", async () => {
  const server = await startHealthServer({ port: 0, host: "127.0.0.1", getStatus: () => ({ ok: false }) });
  const port = (server.address() as AddressInfo).port;
  try { assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 503); } finally { server.close(); }
});
