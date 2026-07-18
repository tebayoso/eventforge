create extension if not exists vector;

create table if not exists eventforge_audit_entries (
  id uuid primary key,
  workspace_id text not null,
  kind text not null,
  subject_id text not null,
  message text not null,
  created_at timestamptz not null
);

create index if not exists eventforge_audit_entries_workspace_created_idx
  on eventforge_audit_entries (workspace_id, created_at desc);

create table if not exists eventforge_events (
  id uuid primary key,
  workspace_id text not null,
  project_id text not null,
  repository text,
  provider text not null check (provider in ('github', 'linear', 'sentry', 'custom')),
  topic text not null,
  installation_key text not null,
  delivery_id text not null,
  payload jsonb not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (provider, installation_key, delivery_id)
);

create index if not exists eventforge_events_workspace_received_idx
  on eventforge_events (workspace_id, received_at desc);

create table if not exists eventforge_jobs (
  id uuid primary key,
  workspace_id text not null,
  event_id uuid not null references eventforge_events(id),
  kind text not null,
  status text not null check (status in ('pending', 'processing', 'completed', 'failed', 'dead_letter', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  worker_id text,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists eventforge_jobs_claimable_idx
  on eventforge_jobs (available_at, created_at)
  where status = 'pending';

create table if not exists eventforge_agent_runs (
  id uuid primary key,
  workspace_id text not null,
  workflow_id uuid not null,
  event_id uuid not null references eventforge_events(id),
  thread_id text,
  status text not null,
  structured_result jsonb,
  started_at timestamptz not null,
  finished_at timestamptz
);

create index if not exists eventforge_agent_runs_workspace_started_idx
  on eventforge_agent_runs (workspace_id, started_at desc);

create table if not exists eventforge_action_proposals (
  id uuid primary key,
  workspace_id text not null,
  workflow_id uuid not null,
  event_id uuid not null references eventforge_events(id),
  version integer not null default 1 check (version > 0),
  policy_version integer not null check (policy_version > 0),
  policy_snapshot_hash text not null,
  status text not null,
  proposal jsonb not null,
  reviewer_id text,
  decision_reason text,
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists eventforge_action_proposals_pending_idx
  on eventforge_action_proposals (workspace_id, created_at desc)
  where status = 'pending';

create table if not exists eventforge_memory_vectors (
  id uuid primary key,
  workspace_id text not null,
  project_id text not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists eventforge_memory_vectors_scope_created_idx
  on eventforge_memory_vectors (workspace_id, project_id, created_at desc);
