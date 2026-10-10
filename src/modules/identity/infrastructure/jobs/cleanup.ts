import type { Pool } from "pg";
import type { JobHandler } from "@/shared/application/ports/job-queue";
import { ABSOLUTE_DAYS, IDLE_HOURS } from "../../domain/session";

/**
 * `identity.cleanup`: deletes sign-in attempts past their expiry and admin
 * sessions past the idle or absolute limit that no request has visited.
 * Writes no audit entries and logs counts only. Boundaries match the domain:
 * a session exactly on a limit is still valid, an attempt is live only while
 * `expires_at` is in the future. See specs/system/security.md, "Sessions",
 * and specs/system/jobs.md, "Recurring jobs".
 */
export function createIdentityCleanupHandler(pool: Pool): JobHandler {
  return async (_payload, ctx) => {
    const now = ctx.clock.now();
    const attempts = await pool.query("delete from sign_in_attempt where expires_at <= $1", [now]);
    const sessions = await pool.query(
      // Hours on both limits: calendar days would shift with the session time zone.
      `delete from admin_session
       where last_seen_at < $1::timestamptz - make_interval(hours => $2)
          or created_at < $1::timestamptz - make_interval(hours => $3)`,
      [now, IDLE_HOURS, ABSOLUTE_DAYS * 24],
    );
    ctx.logger.info("purged expired identity rows", {
      attempts: attempts.rowCount ?? 0,
      sessions: sessions.rowCount ?? 0,
    });
  };
}
