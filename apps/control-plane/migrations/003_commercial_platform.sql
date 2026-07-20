create table if not exists eventforge_platform_resources (
  id uuid primary key,
  workspace_id text not null,
  project_id text,
  resource_type text not null check (resource_type in ('workspace','project','environment','member','integration','endpoint','route','delivery','delivery_attempt','issue','alert_policy','incident','reaction_policy','reaction_run','evidence_bundle')),
  idempotency_key text,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, resource_type, idempotency_key)
);

create index if not exists eventforge_platform_resources_scope_idx
  on eventforge_platform_resources (workspace_id, project_id, resource_type, created_at desc);

create table if not exists eventforge_entitlements (
  workspace_id text primary key,
  plan text not null check (plan in ('developer','team','pro','business','enterprise')),
  delivered_events_included bigint not null check (delivered_events_included >= 0),
  smart_reactions_included bigint not null check (smart_reactions_included >= 0),
  hard_spend_cap_usd numeric(12,4) check (hard_spend_cap_usd >= 0),
  effective_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists eventforge_usage_records (
  id uuid primary key,
  workspace_id text not null,
  project_id text not null,
  idempotency_key text not null,
  meter text not null check (meter in ('delivered_event','smart_reaction')),
  quantity bigint not null check (quantity > 0),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, meter, idempotency_key)
);

create index if not exists eventforge_usage_records_daily_idx
  on eventforge_usage_records (workspace_id, meter, occurred_at);
