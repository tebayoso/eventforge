-- Hosted identity source of truth. Sessions and request tokens are deliberately absent: they live only in SessionAuthority.
create table if not exists identities (
  id text primary key,
  normalized_email text not null unique,
  verified_at text,
  created_at text not null,
  closed_at text
);
create table if not exists email_challenges (
  id text primary key,
  identity_id text not null references identities(id),
  token_hash text not null unique,
  expires_at text not null,
  used_at text,
  created_at text not null
);
create table if not exists workspace_memberships (
  workspace_id text not null references workspaces(id),
  identity_id text not null references identities(id),
  role text not null check (role in ('owner','admin','operator','viewer')),
  version integer not null default 1,
  created_at text not null,
  updated_at text not null,
  primary key (workspace_id, identity_id)
);
create table if not exists workspace_invitations (
  id text primary key,
  workspace_id text not null references workspaces(id),
  normalized_email text not null,
  role text not null check (role in ('admin','operator','viewer')),
  inviter_identity_id text not null references identities(id),
  expires_at text not null,
  accepted_at text,
  cancelled_at text,
  created_at text not null
);
create table if not exists identity_factors (
  id text primary key,
  identity_id text not null references identities(id),
  kind text not null check (kind in ('totp','webauthn')),
  credential_id text unique,
  public_key text,
  sign_count integer,
  aaguid text,
  backup_eligible integer,
  backup_state integer,
  resident integer,
  created_at text not null,
  revoked_at text
);
create table if not exists recovery_codes (
  id text primary key,
  identity_id text not null references identities(id),
  salt text not null,
  hash text not null,
  consumed_at text,
  created_at text not null
);
create table if not exists governance_audit_events (
  id text primary key,
  workspace_id text not null references workspaces(id),
  actor_identity_id text not null references identities(id),
  session_id text,
  kind text not null,
  subject_id text not null,
  metadata text not null default '{}',
  created_at text not null
);
create index if not exists email_challenges_active_idx on email_challenges(identity_id, expires_at) where used_at is null;
create index if not exists invitations_email_idx on workspace_invitations(normalized_email, expires_at) where accepted_at is null and cancelled_at is null;
create index if not exists memberships_identity_idx on workspace_memberships(identity_id, workspace_id);
create index if not exists governance_audit_workspace_idx on governance_audit_events(workspace_id, created_at desc);
