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

create table if not exists eventforge_memory_vectors (
  id uuid primary key,
  workspace_id text not null,
  project_id text not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);
