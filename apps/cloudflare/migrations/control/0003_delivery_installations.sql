-- Queue messages carry this verified mapping identity; payload fields never select a tenant.
create table if not exists delivery_installations (
  id text primary key,
  workspace_id text not null references workspaces(id),
  provider text not null,
  installation_key text not null,
  status text not null check (status in ('active','suspended','deleted')),
  created_at text not null,
  updated_at text not null,
  unique (workspace_id, id),
  unique (provider, installation_key)
);

create index if not exists delivery_installations_workspace_idx
  on delivery_installations(workspace_id, status);
