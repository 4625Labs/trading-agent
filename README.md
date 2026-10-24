# trading-agent

Agent Builders Hackathon entry: a trading agent that learns signals from web news, respects user preferences, runs synthetic trades alongside testnet trades, and self-improves, with human-in-the-loop approvals via Omnara.

Stack: TypeScript, Supabase, context.dev, Freestyle, Omnara. See `docs/architecture.png`.

Layout: `apps/worker` (agent), `apps/dashboard` (UI), `packages/shared` (types), `supabase/migrations`.

Setup: copy `.env.example` to `.env` and fill in values. Never commit `.env`.
