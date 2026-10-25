-- Rolling "time machine" hold-out test (replay) and live shadow control arm.

-- One run = many random start points ("windows"): learn for N cycles, freeze, test on the next M unseen cycles.
create table if not exists rolling_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',     -- running | done | failed
  params jsonb not null default '{}',          -- windows, learnCycles, testCycles, seed, history span, ...
  progress int not null default 0,             -- windows completed
  summary jsonb not null default '{}',         -- mean delta, CI, windows won, verdict, disclaimer, warmStartWeights
  error text
);
alter table rolling_runs enable row level security;

create table if not exists rolling_windows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references rolling_runs(id) on delete cascade,
  k int not null,
  start_ts timestamptz,                        -- historical time the window starts
  learn_cycles int not null,
  test_cycles int not null,
  learned_pnl numeric not null default 0,      -- test stretch, frozen learned weights
  baseline_pnl numeric not null default 0,     -- test stretch, equal weights
  delta numeric not null default 0,            -- learned - baseline
  learned_trades int not null default 0,
  baseline_trades int not null default 0,
  learned_hit numeric,
  baseline_hit numeric,
  learned_maxdd numeric,
  baseline_maxdd numeric,
  weights jsonb not null default '{}',         -- frozen weights after the learn phase
  detail jsonb not null default '{}'
);
create index if not exists rolling_windows_run_idx on rolling_windows (run_id, k);
alter table rolling_windows enable row level security;

-- Live shadow control arm: practice-only trades for two policies on the same signals.
-- policy: 'learned' (learned source weights) | 'equal' (all weights 1.0, never learns)
create table if not exists shadow_trades (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid,
  policy text not null,
  asset text not null,
  direction text not null,
  size numeric not null,
  entry numeric not null,
  stop numeric not null,
  target numeric not null,
  status text not null default 'open',         -- open | closed
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  exit_price numeric,
  exit_reason text,                            -- stop | target | timeout
  pnl numeric,
  votes jsonb not null default '{}'            -- {source: contribution} that produced the trade
);
create index if not exists shadow_trades_policy_idx on shadow_trades (policy, status, opened_at desc);
alter table shadow_trades enable row level security;

-- Learned weights for live shadow sources (technical:* and news sources) used by the 'learned' policy.
create table if not exists shadow_weights (
  source text primary key,
  weight numeric not null default 1.0,
  hits int not null default 0,
  trials int not null default 0,
  updated_at timestamptz not null default now()
);
alter table shadow_weights enable row level security;
