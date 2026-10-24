-- Demo/ops command queue: the dashboard inserts rows, the worker polls and executes them.
create table if not exists commands (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending',
  result text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists commands_status_idx on commands (status, created_at);
alter table commands enable row level security;
