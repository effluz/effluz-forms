-- Owned by the media module. No foreign key to submission: deletion runs through
-- media.delete so a provider outage never leaves a row pointing at nothing.
create table media (
  id uuid primary key,
  submission_id uuid not null,
  form_id uuid not null,
  field_key text not null,
  position integer not null check (position >= 1),
  kind text not null check (kind in ('image', 'video')),
  status text not null check (status in ('staged', 'stored', 'failed')),
  content_type text not null,
  size bigint not null check (size >= 0),
  staging_ref text,
  durable_key text not null,
  provider_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_submission_field_position_key unique (submission_id, field_key, position)
);
