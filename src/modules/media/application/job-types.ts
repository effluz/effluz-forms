/** Job types the media module registers. See specs/system/media-storage.md, "Lifecycle". */
export const MEDIA_JOB_TYPES = { upload: "media.upload", delete: "media.delete" } as const;

/**
 * Attempt limit for every `media.*` job: with the backoff of 2^attempt seconds
 * capped at one hour, 36 attempts cover about a day of provider outage. See
 * specs/system/jobs.md, "Job types in the first release".
 */
export const MEDIA_JOB_MAX_ATTEMPTS = 36;
