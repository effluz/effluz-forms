create table admin_session (
  id uuid primary key,
  email text not null,
  name text not null,
  csrf_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index admin_session_email_idx on admin_session (email);

create table sign_in_attempt (
  id uuid primary key,
  state text not null,
  nonce text not null,
  code_verifier text not null,
  return_to text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table audit_log (
  id uuid primary key,
  action text not null,
  actor_email text,
  target_id text,
  ip text,
  details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_log_created_idx on audit_log (created_at desc);
create index audit_log_actor_idx on audit_log (actor_email, created_at desc);

create function audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_append_only();
