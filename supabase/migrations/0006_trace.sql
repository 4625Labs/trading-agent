-- Human-readable trail of what the agent did and why; read by the dashboard Trace page.
create table if not exists agent_events (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  kind text not null,
  title text not null,
  detail jsonb not null default '{}',
  thesis_id uuid references theses(id) on delete cascade,
  agent_id text
);
create index if not exists agent_events_ts_idx on agent_events (ts desc);
create index if not exists agent_events_thesis_idx on agent_events (thesis_id);
alter table agent_events enable row level security;
