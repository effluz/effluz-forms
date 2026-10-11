-- The per-form submission reference sequence; see allocateReference.
alter table form add column next_reference integer not null default 1 check (next_reference >= 1);
