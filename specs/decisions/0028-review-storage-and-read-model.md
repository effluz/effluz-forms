# 0028. Review storage and read model

Status: accepted
Date: 2026-10-18

## Context

The review module adds state to a submission: a planned date, readiness
ticks, chosen photos, photos that staff add, and the edit history. None of it
may touch `answers`, which stays byte-identical to what the sender submitted
(ADR 0011). The list, the post plan and the export filter on tables of four
owners at once (`submission`, `story`, `media`, `job`), and no single owner
can answer them under the 500 ms budget. Staff photos must follow the
sender's files through upload, delete and retention without a second code
path.

## Decision

1. `review` owns `story`, `staff_photo` and `submission_edit`, each
   `on delete cascade` from `submission`. The curation columns (`status`,
   `curated_answers`, `published_post_url`, `status_changed_*`) stay on
   `submission` and are written only through `submissions` use cases.
2. Staff photos are `media` rows under the reserved field key `staff-photos`.
   The hyphen means it can never be a valid field key. Their storage keys
   follow `system/media-storage.md`.
3. Readiness is computed when read, from the chosen set, the set recorded at
   the "photos edited" tick, and the text tick. No "ready" flag is stored, so
   it cannot drift.
4. One unpublished story per day is held by a partial unique index
   (`story_plan_slot_key`) and a per-day advisory lock
   (`pg_advisory_xact_lock` on `story-plan:<date>`), taken in date order after
   the submission and story rows.
5. `PgReviewQueries` may read `submission`, `media` and `job`, never write
   them, for the list, the plan and the export. Single-story reads still go
   through the owners' use cases.

## Consequences

- The read model breaks when those tables change shape, so its integration
  tests run against the real migrations.
- A field key with a hyphen is reserved for the system forever.
- Deleting a submission row removes every piece of review state in one
  statement; the media rows are removed through `media.delete` jobs.
- Review reads other owners' tables in SQL. That is accepted for reads only;
  any write goes through the owner's use case.
