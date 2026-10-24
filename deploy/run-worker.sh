#!/bin/bash
# Worker launcher used by trading-worker.service.
# Args: $WORKER_ARGS (from /root/app/.env) > "attach $(cat /root/app/.agent-id)" > "serve".
cd /root/app
ARGS="${WORKER_ARGS:-}"
if [ -z "$ARGS" ]; then
  if [ -s /root/app/.agent-id ]; then ARGS="attach $(tr -d '[:space:]' < /root/app/.agent-id)"; else ARGS="serve"; fi
fi
exec /usr/local/bin/bun run apps/worker/src/index.ts $ARGS
