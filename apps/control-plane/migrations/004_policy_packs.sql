create table if not exists eventforge_policy_packs (
  workspace_id text not null,
  pack_id text not null,
  version integer not null check (version > 0),
  status text not null check (status in ('draft','published','active','retired','superseded')),
  manifest jsonb not null,
  manifest_digest char(64) not null,
  signer_key_id text,
  signature text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  primary key (workspace_id, pack_id, version),
  unique (workspace_id, manifest_digest)
);

create table if not exists eventforge_policy_activations (
  workspace_id text not null,
  sequence bigint not null,
  pack_id text not null,
  version integer not null,
  manifest_digest char(64) not null,
  activated_by text not null,
  approved_digest char(64) not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, sequence),
  foreign key (workspace_id, pack_id, version) references eventforge_policy_packs(workspace_id, pack_id, version)
);

create table if not exists eventforge_policy_simulations (
  id uuid primary key,
  workspace_id text not null,
  manifest_digest char(64) not null,
  evaluator_version text not null,
  input_snapshot_digest char(64) not null,
  status text not null check (status in ('queued','running','complete','partial','blocked','cancelled')),
  coverage_numerator integer not null default 0,
  coverage_denominator integer not null default 0,
  reason_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
