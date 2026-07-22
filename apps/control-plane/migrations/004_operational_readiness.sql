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
-- Evidence and switch records are append-only: no update/delete grants belong to runtime roles.
