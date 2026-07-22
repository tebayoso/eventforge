create table if not exists eventforge_entitlement_versions (
  id uuid primary key,
  workspace_id text not null,
  catalog_version text not null,
  state text not null check (state in ('none','trialing','active','past_due','grace','cancel_scheduled','cancelled','disputed','pending_reconciliation')),
  plan text check (plan in ('team','business')),
  stripe_event_hash text not null unique,
  stripe_customer_hash text not null,
  stripe_subscription_hash text,
  provider_created_at timestamptz not null,
  observed_at timestamptz not null default now(),
  effective_from timestamptz not null,
  effective_until timestamptz,
  payload_hash text not null
);
create index if not exists eventforge_entitlement_versions_current_idx on eventforge_entitlement_versions (workspace_id, provider_created_at desc);

create table if not exists eventforge_stripe_workspace_bindings (
  workspace_id text primary key,
  stripe_customer_hash text not null unique,
  stripe_subscription_hash text unique,
  created_at timestamptz not null default now()
);

create table if not exists eventforge_billing_usage_ledger (
  workspace_id text not null,
  logical_investigation_hash text not null,
  meter text not null check (meter in ('customer_requested_investigation','controlled_reaction')),
  source_idempotency_key text not null,
  billing_effect text not null check (billing_effect in ('counted','none')),
  accepted_at timestamptz not null,
  primary key (workspace_id, meter, source_idempotency_key)
);
