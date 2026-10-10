create table job (
  id uuid primary key,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('pending','running','succeeded','failed','dead','discarded')),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  unique_key text,
  last_error text,
  discard_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index job_claim_idx on job (status, run_at) where status in ('pending','failed');
create unique index job_unique_key_idx on job (unique_key) where status in ('pending','running') and unique_key is not null;
