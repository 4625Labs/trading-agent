-- Agents launched by the worker; the dashboard reads active ones to find open Omnara interactions.
create table if not exists agents (id text primary key, name text, status text default 'active', created_at timestamptz default now());
alter table agents enable row level security;
