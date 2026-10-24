alter table signals add column if not exists rationale text;
alter table signals add column if not exists source_name text;
alter table signals add column if not exists raw_hash text;
create unique index if not exists signals_raw_hash_key on signals(raw_hash);
create index if not exists signals_created_at_idx on signals(created_at desc);
