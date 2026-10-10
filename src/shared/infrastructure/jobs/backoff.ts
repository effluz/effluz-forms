const ONE_HOUR_MS = 3_600_000;

/**
 * Retry delay for the given attempt number (1-based): 2^attempt seconds plus up
 * to 25% jitter, capped at one hour. See specs/system/jobs.md, "Worker behavior".
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(ONE_HOUR_MS, 2 ** attempt * 1000);
  return Math.min(ONE_HOUR_MS, Math.round(base * (1 + 0.25 * random())));
}
