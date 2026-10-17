-- Owned by notifications. One row per sent message, so a retried job sends nothing.
create table email_delivery (
  id uuid primary key,
  delivery_key text not null,
  provider_message_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_delivery_key unique (delivery_key)
);
