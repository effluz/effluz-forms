export type HeartbeatState = "ok" | "warning" | "critical";

/** A worker beat no older than this is healthy. */
export const HEARTBEAT_OK_SECONDS = 60;

/**
 * OK up to `HEARTBEAT_OK_SECONDS`, Warning up to `staleSeconds` (the caller passes
 * `HEARTBEAT_STALE_SECONDS`), Critical above that or when no worker ever wrote a beat.
 */
export function heartbeatState(ageSeconds: number | null, staleSeconds: number): HeartbeatState {
  if (ageSeconds === null) return "critical";
  if (ageSeconds <= HEARTBEAT_OK_SECONDS) return "ok";
  return ageSeconds <= staleSeconds ? "warning" : "critical";
}
