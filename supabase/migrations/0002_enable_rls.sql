-- Lock down all app tables: no policies = no anon/authenticated access. The worker uses the secret key, which bypasses RLS.
alter table preferences enable row level security;
alter table sources enable row level security;
alter table signals enable row level security;
alter table theses enable row level security;
alter table synthetic_trades enable row level security;
alter table real_trades enable row level security;
alter table approvals enable row level security;
alter table lessons enable row level security;
alter table runs enable row level security;
alter table wallet_snapshots enable row level security;
alter table guardrail_events enable row level security;
alter table _migrations enable row level security;
