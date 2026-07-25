create table if not exists eventforge_provider_installations (
  id uuid primary key,
  workspace_id text not null,
  provider text not null check (provider in ('linear', 'sentry')),
  provider_account_id text not null,
  installation_key text not null,
  mode text not null check (mode in ('read_only', 'reaction_enabled')),
  resource_mode text not null check (resource_mode in ('selective', 'all_discovered')),
  resource_ids jsonb not null,
  state text not null check (state in ('pending', 'healthy', 'degraded', 'expired', 'revoked', 'misconfigured', 'disconnected')),
  scope_version integer not null check (scope_version > 0),
  checked_at timestamptz,
  last_verified_event_at timestamptz,
  credential_ciphertext bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, installation_key),
  unique (workspace_id, provider, provider_account_id)
);

create index if not exists eventforge_provider_installations_workspace_idx
  on eventforge_provider_installations (workspace_id, provider, state);
