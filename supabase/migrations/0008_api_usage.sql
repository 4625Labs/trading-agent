-- One row per outbound call to an integration, so the dashboard can show real usage.
create table if not exists api_usage (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  provider text not null,          -- contextdev | anthropic | binance | omnara
  endpoint text not null,
  status int,
  credits_used numeric,
  credits_remaining numeric,
  detail jsonb not null default '{}'
);
create index if not exists api_usage_provider_ts_idx on api_usage (provider, ts desc);
alter table api_usage enable row level security;
