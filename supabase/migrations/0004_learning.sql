-- Self-learning loop + close-out. All statements idempotent.
alter table sources add column if not exists hits int not null default 0;
alter table sources add column if not exists trials int not null default 0;
alter table sources add column if not exists pnl_sum numeric not null default 0;
alter table sources add column if not exists updated_at timestamptz;

alter table theses add column if not exists closed_at timestamptz;
alter table theses add column if not exists exit_reason text;
alter table theses add column if not exists exit_price numeric;
alter table theses add column if not exists pnl numeric;
alter table theses add column if not exists feedback_asked_at timestamptz;
alter table theses add column if not exists feedback text;
alter table theses add column if not exists feedback_at timestamptz;

alter table synthetic_trades add column if not exists exit_price numeric;
alter table synthetic_trades add column if not exists exit_reason text;
alter table real_trades add column if not exists closed_at timestamptz;
alter table real_trades add column if not exists exit_price numeric;

alter table lessons add column if not exists key text;
create unique index if not exists lessons_key_uq on lessons(key);

create table if not exists calibration (
  id uuid primary key default gen_random_uuid(),
  n int not null,
  brier real,
  base_rate real,
  bins jsonb not null default '[]',
  created_at timestamptz default now()
);
alter table calibration enable row level security;
