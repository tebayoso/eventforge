create table if not exists eventforge_launch_evidence (
  id uuid primary key, workspace_id text not null, surface text not null,
  result text not null check (result in ('unknown','passed','failed','skipped')),
  evidence_kind text not null, correlation_id text not null, observed_at timestamptz not null,
  provenance jsonb not null, created_at timestamptz not null default now()
);
create table if not exists eventforge_kill_switch_audit (
  id uuid primary key, surface text not null, enabled boolean not null, actor_id text not null,
  mfa_verified_at timestamptz not null, security_authorized boolean not null, reason text not null,
  created_at timestamptz not null default now()
);
-- Added after the statement above shipped. Editing that statement instead would be silently skipped
-- by `if not exists` wherever it already ran, leaving audit inserts to fail against a missing column.
alter table eventforge_kill_switch_audit
  add column if not exists authorization_id text;
do $$
begin
  if exists (select 1 from eventforge_kill_switch_audit where authorization_id is null) then
    raise exception
      'kill-switch audit rows lack authorization_id; archive them before enforcing not null';
  end if;
  alter table eventforge_kill_switch_audit alter column authorization_id set not null;
end $$;
create index if not exists eventforge_launch_evidence_workspace_observed
  on eventforge_launch_evidence (workspace_id, observed_at, created_at);
create index if not exists eventforge_kill_switch_surface_created
  on eventforge_kill_switch_audit (surface, created_at);
-- Evidence and switch records are append-only: no update/delete grants belong to runtime roles.
