-- Owned by review. Every row goes with its submission (on delete cascade). See ADR 0028.
create table story (
  submission_id uuid primary key references submission (id) on delete cascade,
  form_id uuid not null,
  planned_on date,
  published_on date,
  chosen_media uuid[] not null default '{}',
  photos_edited_for uuid[],
  photos_edited_by text,
  photos_edited_at timestamptz,
  text_checked_by text,
  text_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One unpublished story per day across every form in the post plan.
create unique index story_plan_slot_key on story (planned_on)
  where planned_on is not null and published_on is null;
create index story_published_on_idx on story (published_on) where published_on is not null;

create table staff_photo (
  id uuid primary key,
  submission_id uuid not null references submission (id) on delete cascade,
  source text not null check (source in ('whatsapp', 'instagram', 'email', 'other')),
  sender_confirmed boolean not null check (sender_confirmed),
  added_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_photo_submission_idx on staff_photo (submission_id, created_at);

create table submission_edit (
  id uuid primary key,
  submission_id uuid not null references submission (id) on delete cascade,
  field_key text not null,
  text text not null,
  source text not null check (source in ('manual', 'suggested')),
  editor text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index submission_edit_submission_idx on submission_edit (submission_id, field_key, created_at desc);

create function submission_edit_no_update() returns trigger language plpgsql as $$
begin
  raise exception 'submission edits are append-only';
end $$;
create trigger submission_edit_no_update before update on submission_edit
  for each row execute function submission_edit_no_update();
