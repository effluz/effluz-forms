-- Owned by submissions. Personal data: in-progress rows go at submit or after 24 hours.
create table submission_in_progress (
  id uuid primary key,
  form_id uuid not null references form (id) on delete cascade,
  form_version_id uuid not null references form_version (id),
  locale text not null check (locale in ('en', 'es')),
  page_key text not null,
  answers jsonb not null default '{}',
  files jsonb not null default '{}',
  pending jsonb,
  submit_token uuid not null,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index submission_in_progress_expires_idx on submission_in_progress (expires_at);

create table submission (
  id uuid primary key,
  form_id uuid not null references form (id),
  form_version_id uuid not null references form_version (id),
  locale text not null check (locale in ('en', 'es')),
  answers jsonb not null,
  consent jsonb,
  received_at timestamptz not null,
  reference text not null,
  submit_token uuid not null,
  status text not null default 'new' check (status in ('new', 'viewed', 'edited', 'published')),
  curated_answers jsonb not null default '{}',
  published_post_url text,
  status_changed_by text,
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submission_form_reference_key unique (form_id, reference),
  constraint submission_submit_token_key unique (submit_token)
);
create index submission_form_received_idx on submission (form_id, received_at desc);

create function submission_answers_immutable() returns trigger language plpgsql as $$
begin
  if new.answers is distinct from old.answers then
    raise exception 'submission answers are immutable';
  end if;
  return new;
end $$;
create trigger submission_answers_immutable before update on submission
  for each row execute function submission_answers_immutable();
