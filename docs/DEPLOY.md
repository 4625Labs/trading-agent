# Deploy runbook (Freestyle VM)

One Freestyle VM runs two systemd services (both `Restart=always`, `EnvironmentFile=/root/app/.env`):

| unit | what | port | public URL |
|---|---|---|---|
| `trading-worker` | `bun run apps/worker/src/index.ts <args>` via `deploy/run-worker.sh` | 8080 (`/health`) | `https://<slug>-worker.style.dev/health` |
| `trading-dashboard` | `next start` under bun | 3000 | `https://<slug>.style.dev` |

Worker args: `WORKER_ARGS` from the VM `.env`, else `attach $(cat /root/app/.agent-id)`, else `serve` (attach to all active agents in the DB; needs `serve` support in index.ts).
The VM is created with `idleTimeoutSeconds`, `autoDeleteSeconds`, `ttlSeconds`, `maxRunSeconds` all `-1` (never paused or deleted). State (vmId, slug, URLs, tls rule ids, snapshots) is in `.freestyle-deploy.json` (gitignored).

## Commands (run from repo root; needs `FREESTYLE_API_KEY` in local `.env`)

```
node scripts/deploy-freestyle.mjs deploy            # create/reuse VM, upload code, write .env, bun install, build, units, TLS, health check
node scripts/deploy-freestyle.mjs redeploy          # fast: re-sync code + .env, restart units (~3s). REDEPLOY_INSTALL=1 to also bun install + build
node scripts/deploy-freestyle.mjs status
node scripts/deploy-freestyle.mjs logs trading-worker    # LINES=300 for more; also trading-dashboard
node scripts/deploy-freestyle.mjs restart
node scripts/deploy-freestyle.mjs snapshot          # capture VM (memory + disk)
node scripts/deploy-freestyle.mjs sh '<root command>'
node scripts/deploy-freestyle.mjs destroy [--snapshots]  # delete VM + TLS rules
```

Pin the agent: `node scripts/deploy-freestyle.mjs sh 'echo <agent_id> > /root/app/.agent-id' && ... restart` (the file survives redeploys; it is excluded from the tarball).

## Secrets

Only the variables listed in `ENV_KEYS` in `scripts/deploy-freestyle.mjs` are copied from local `.env` to `/root/app/.env` (mode 600). Values are never printed; `FREESTYLE_API_KEY` is not copied. Omnara's API cannot return secret values, so exchange keys live in the VM `.env`, copied from the local `.env`. To rotate: edit local `.env`, `redeploy`.

## Rollback

`snapshot` before risky changes. To roll back, create a VM from the snapshot (`freestyle.vms.create({ snapshotId, idleTimeoutSeconds: -1, firewall: ... })`), point the TLS rules at the new vmId (`freestyle.tls.rules.update`), and update `vmId` in `.freestyle-deploy.json`. For code-only rollback, check out the old commit locally and `redeploy`.

## Notes

- exec runs as non-root by default; the script uses `vm.linuxUser("root")`. The default image has bun but no node, so everything runs under bun (verified: guardrails/simulator/db/omnara/binance/loop imports, `node:crypto`, `pg`, `import.meta.url`, `node:http`, and all worker tests pass under `bun test`).
- Dashboard build runs with `set -a; . /root/app/.env` so `NEXT_PUBLIC_*` vars are inlined at build time. Redeploying with dashboard changes needs `REDEPLOY_INSTALL=1`.
