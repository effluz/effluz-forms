create table worker_heartbeat (
  id uuid primary key,
  worker_id text not null unique,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
