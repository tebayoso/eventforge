create table if not exists workspaces (
  id text primary key,
  name text not null,
  plan text not null default 'developer' check (plan in ('developer','team','pro','business','enterprise')),
  created_at text not null
);

create table if not exists integrations (
  id text primary key,
  workspace_id text not null references workspaces(id),
  provider text not null,
  external_key text not null,
  encrypted_secret text not null,
  enabled integer not null default 1 check (enabled in (0,1)),
  created_at text not null,
  unique (provider, external_key)
);

create table if not exists entitlements (
  workspace_id text primary key references workspaces(id),
  delivered_events_included integer not null default 25000,
  smart_reactions_included integer not null default 0,
  hard_spend_cap_cents integer,
  effective_at text not null
);
