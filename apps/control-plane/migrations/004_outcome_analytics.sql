create table if not exists eventforge_outcome_transitions (
  id uuid primary key,
  workspace_id text not null,
  subject_id text not null,
  state text not null check (state in ('proposed','approved','rejected','expired','executed','effect-verified','effect-failed','rolled-back','resolution-verified','recurrence','unknown','excluded')),
  occurred_at timestamptz not null,
  evidence jsonb not null,
  attribution_id text,
  created_at timestamptz not null default now()
);
create index if not exists eventforge_outcome_transitions_projection_idx
  on eventforge_outcome_transitions (workspace_id, subject_id, occurred_at desc);

create table if not exists eventforge_metric_snapshots (
  id uuid primary key,
  workspace_id text not null,
  metric_version text not null,
  membership_version text not null,
  correlation_version text not null,
  source_cutoff timestamptz not null,
  definition jsonb not null,
  values jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists eventforge_metric_snapshots_workspace_created_idx
  on eventforge_metric_snapshots (workspace_id, created_at desc);
