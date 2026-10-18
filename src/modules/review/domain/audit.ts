/** Every audit action the review module writes: the table in `specs/system/security.md`. */
export const reviewAuditActions = [
  "submissions_listed",
  "submission_viewed",
  "photo_viewed",
  "media_downloaded",
  "submissions_exported",
  "submission_deleted",
  "submission_edited",
  "submission_reverted",
  "submission_status_changed",
  "staff_photos_added",
  "staff_photo_removed",
  "photo_choice_changed",
  "story_check_changed",
  "story_planned",
  "post_plan_viewed",
  "job_retried",
  "job_discarded",
  "jobs_retried_bulk",
] as const;
export type ReviewAuditAction = (typeof reviewAuditActions)[number];
