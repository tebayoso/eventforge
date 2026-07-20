create table if not exists events (
  id text primary key,
  workspace_id text not null,
  project_id text not null,
  environment_id text not null,
  provider text not null,
  topic text not null,
  provider_delivery_id text not null,
  idempotency_key text not null,
  payload_ref text not null,
  payload_checksum text not null,
  status text not null check (status in ('pending','queued','processing','processed','failed')),
  occurred_at text not null,
  received_at text not null,
  unique (workspace_id, provider, provider_delivery_id),
  unique (workspace_id, idempotency_key)
);

create table if not exists outbox (
  id text primary key,
  workspace_id text not null,
  operation text not null,
  idempotency_key text not null,
  payload text not null,
  published_at text,
  created_at text not null,
  unique (workspace_id, operation, idempotency_key)
);

create table if not exists audit_entries (
  id text primary key,
  workspace_id text not null,
  kind text not null,
  subject_id text not null,
  message text not null,
  created_at text not null
);

create index if not exists events_workspace_received_idx on events(workspace_id, received_at desc);
create index if not exists outbox_pending_idx on outbox(created_at) where published_at is null;
