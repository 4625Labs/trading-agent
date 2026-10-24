-- Configurable cycles, cycle ledger, 100-cycle replay results, execution-gap support.

-- Single editable config row (id='default'). Keys: enabled, intervalSeconds, assets[], confidenceBar,
-- maxTradesPerCycle, tradeSizeUsd, realOrders. The worker validates and clamps on read.
create table if not exists agent_config (
  id text primary key default 'default',
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table agent_config enable row level security;

-- One row per live cycle (numbered). Outcomes are filled in as the linked theses close.
create table if not exists cycles (
  id uuid primary key default gen_random_uuid(),
  n serial,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  config jsonb not null default '{}',
  signals_considered int not null default 0,
  new_signals int not null default 0,
  ideas int not null default 0,
  proposed int not null default 0,
  thesis_ids uuid[] not null default '{}',
  closed int not null default 0,
  wins int not null default 0,
  pnl numeric not null default 0,
  weights jsonb not null default '{}',
  lessons_count int not null default 0,
  notes text
);
create index if not exists cycles_started_idx on cycles (started_at desc);
alter table cycles enable row level security;

-- Replay of N cycles through the real decision code on historical prices.
create table if not exists replay_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',   -- running | done | failed
  params jsonb not null default '{}',        -- seed, cycles, llm, sources, ...
  progress int not null default 0,           -- cycles completed
  summary jsonb not null default '{}',       -- final numbers, per arm, incl. disclaimer
  error text
);
alter table replay_runs enable row level security;

-- One row per cycle per arm. arm: learner | baseline | llm_lessons | llm_nolessons
create table if not exists replay_cycles (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references replay_runs(id) on delete cascade,
  n int not null,
  arm text not null,
  sim_ts timestamptz,                        -- historical time of this cycle
  trades int not null default 0,
  pnl numeric not null default 0,            -- this cycle
  cum_pnl numeric not null default 0,
  hit_rate_20 numeric,                       -- rolling 20-cycle hit rate
  brier numeric,
  weights jsonb not null default '{}',       -- source -> weight after this cycle
  lessons int not null default 0,
  detail jsonb not null default '{}'
);
create index if not exists replay_cycles_run_idx on replay_cycles (run_id, arm, n);
alter table replay_cycles enable row level security;

-- Demo-priced closes are excluded from sim-vs-real comparisons.
alter table theses add column if not exists demo boolean not null default false;

-- Simulator fee/slippage settings learned from observed real fills.
create table if not exists sim_calibration (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  slippage_bps numeric not null,
  fee_bps numeric not null,
  n_trades int not null default 0,
  detail jsonb not null default '{}'
);
alter table sim_calibration enable row level security;
