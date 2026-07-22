-- Forward-only enterprise governance foundation. Remote mode remains fail-closed.
create table if not exists enterprise_organizations (
  id uuid primary key,
  name text not null,
  activated_at timestamptz not null,
  audit_starts_at timestamptz not null
);

create table if not exists enterprise_workspace_memberships (
  enterprise_org_id uuid not null references enterprise_organizations(id),
  workspace_id text not null,
  primary key (enterprise_org_id, workspace_id),
  unique (workspace_id)
);

create table if not exists enterprise_governance_resources (
  id uuid primary key,
  enterprise_org_id uuid not null references enterprise_organizations(id),
  workspace_id text,
  resource_type text not null check (resource_type in ('federation_config','scim_token','scim_resource','group_mapping','session','legal_hold','region_policy','customer_key_reference','audit_cursor','audit_event','sla_measurement')),
  external_id text,
  version text,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enterprise_org_id, workspace_id, resource_type, external_id),
  foreign key (enterprise_org_id, workspace_id) references enterprise_workspace_memberships(enterprise_org_id, workspace_id)
);

create index if not exists enterprise_governance_scope_idx
  on enterprise_governance_resources (enterprise_org_id, workspace_id, resource_type, created_at desc);

-- Audit is deliberately forward-only: pre-activation history is never rewritten.
create table if not exists enterprise_audit_stream_events (
  enterprise_org_id uuid not null references enterprise_organizations(id),
  workspace_id text not null,
  sequence bigint not null check (sequence > 0),
  event_id uuid not null,
  previous_hash text not null,
  canonical_event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (enterprise_org_id, workspace_id, sequence),
  unique (enterprise_org_id, workspace_id, event_id),
  foreign key (enterprise_org_id, workspace_id) references enterprise_workspace_memberships(enterprise_org_id, workspace_id)
);
