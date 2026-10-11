create table form (
  id uuid primary key,
  slug text not null,
  title jsonb not null,
  languages text not null check (languages in ('bilingual', 'en', 'es')),
  status text not null check (status in ('draft', 'published', 'closed', 'archived')),
  settings jsonb not null,
  current_version_id uuid,
  current_version_number integer,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index form_slug_key on form (slug);
create index form_status_idx on form (status);

create table form_draft (
  form_id uuid primary key references form (id) on delete cascade,
  revision integer not null default 1,
  document jsonb not null,
  updated_by text,
  audited_by text,
  audited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table form_version (
  id uuid primary key,
  form_id uuid not null references form (id),
  number integer not null,
  document jsonb not null,
  published_at timestamptz not null,
  published_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_version_form_id_number_key unique (form_id, number)
);
alter table form add constraint form_current_version_fk
  foreign key (current_version_id) references form_version (id) deferrable initially deferred;

create function form_version_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'form_version is immutable';
end $$;
create trigger form_version_no_update before update or delete on form_version
  for each row execute function form_version_immutable();

create table form_visit (
  form_id uuid not null references form (id) on delete cascade,
  email text not null,
  last_opened_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (form_id, email)
);
