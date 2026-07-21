create table if not exists waitlist_signups (
  id text primary key,
  email text not null unique,
  source text not null default 'direct',
  consent_at text not null,
  ip_hash text not null,
  created_at text not null
);

create index if not exists waitlist_ip_created_idx on waitlist_signups(ip_hash, created_at desc);
