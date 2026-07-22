create table if not exists deliveries (
  id text primary key,
  workspace_id text not null,
  installation_id text not null,
  provider text not null,
  provider_delivery_id text not null,
  payload_ref text not null,
  payload_checksum text not null,
  status text not null check (status in ('accepted','queued','processing','retrying','completed','quarantined','rejected')),
  safe_reason text check (safe_reason in ('timeout','validation_error','upstream_unavailable','rate_limited','payload_unavailable','payload_corrupt','payload_too_large','workspace_suspended','workspace_deleted','retry_exhausted','reconciliation')),
  correlation_id text not null,
  attempts_count integer not null default 0 check (attempts_count >= 0 and attempts_count <= 8),
  first_attempt_at text,
  next_retry_at text,
  lease_expires_at text,
  completed_at text,
  quarantined_at text,
  created_at text not null,
  updated_at text not null,
  unique (workspace_id, id),
  unique (workspace_id, provider, provider_delivery_id)
);

create table if not exists delivery_attempts (
  id text primary key,
  workspace_id text not null,
  delivery_id text not null,
  attempt_number integer not null check (attempt_number > 0),
  operation text not null check (operation in ('process','retry','replay','reconciliation','dlq')),
  status text not null check (status in ('processing','completed','failed','quarantined')),
  safe_reason text check (safe_reason in ('timeout','validation_error','upstream_unavailable','rate_limited','payload_unavailable','payload_corrupt','payload_too_large','workspace_suspended','workspace_deleted','retry_exhausted','reconciliation')),
  billing_effect text not null default 'none' check (billing_effect = 'none'),
  lease_expires_at text,
  started_at text not null,
  finished_at text,
  unique (workspace_id, delivery_id, attempt_number),
  foreign key (workspace_id, delivery_id) references deliveries(workspace_id, id)
);

create table if not exists delivery_outcomes (
  id text primary key,
  workspace_id text not null,
  delivery_id text not null,
  idempotency_key text not null,
  created_at text not null,
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, delivery_id) references deliveries(workspace_id, id)
);

-- This is the sole hosted billable source: one initial record per logical delivery.
create table if not exists delivery_usage_records (
  id text primary key,
  workspace_id text not null,
  delivery_id text not null,
  idempotency_key text not null,
  meter text not null default 'delivered_event',
  quantity integer not null default 1 check (quantity = 1),
  billing_effect text not null default 'initial' check (billing_effect = 'initial'),
  created_at text not null,
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, delivery_id) references deliveries(workspace_id, id)
);

create table if not exists delivery_dlq (
  delivery_id text primary key,
  workspace_id text not null,
  safe_reason text not null check (safe_reason in ('timeout','validation_error','upstream_unavailable','rate_limited','payload_unavailable','payload_corrupt','payload_too_large','workspace_suspended','workspace_deleted','retry_exhausted','reconciliation')),
  correlation_id text not null,
  attempts_count integer not null,
  quarantined_at text not null,
  retain_until text not null,
  foreign key (workspace_id, delivery_id) references deliveries(workspace_id, id)
);

create index if not exists deliveries_reconcile_idx on deliveries(status, lease_expires_at, created_at);
create index if not exists delivery_attempts_workspace_idx on delivery_attempts(workspace_id, delivery_id, attempt_number);
