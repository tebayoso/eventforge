create table if not exists eventforge_correlation_configs (
  workspace_id text not null,
  version integer not null check (version > 0),
  effective_at timestamptz not null,
  windows jsonb not null,
  primary key (workspace_id, version)
);

create table if not exists eventforge_incident_memberships (
  id uuid primary key,
  workspace_id text not null,
  project_id text not null,
  incident_id uuid not null,
  event_id uuid not null,
  causal_event_id uuid not null,
  mode text not null check (mode in ('automatic', 'manual')),
  outcome text not null check (outcome in ('proposed', 'accepted', 'superseded', 'ungrouped')),
  matched_signals jsonb not null,
  rule_version integer not null check (rule_version > 0),
  config_version integer not null check (config_version > 0),
  window_minutes integer not null check (window_minutes >= 5),
  reason text not null,
  actor_id text,
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  unique (workspace_id, event_id, incident_id, rule_version, config_version)
);

create index if not exists eventforge_incident_memberships_snapshot_idx
  on eventforge_incident_memberships (workspace_id, incident_id, created_at, id);
