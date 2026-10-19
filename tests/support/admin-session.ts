import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";

/**
 * Inserts an active admin_session row (synthetic staff), as a completed sign-in would.
 * The end-to-end suites use it to reach the manager without Google; the row has the shape
 * PgSessionRepository writes (specs/system/security.md, "Sessions"). Synthetic data only.
 */
export async function seedAdminSession(
  pool: Pool,
  who: { email?: string; name?: string } = {},
): Promise<{ sessionId: string; csrf: string }> {
  const sessionId = randomUUID();
  const csrf = randomBytes(32).toString("base64url");
  await pool.query(
    `insert into admin_session (id, email, name, csrf_token, created_at, updated_at, last_seen_at)
     values ($1, $2, $3, $4, now(), now(), now())`,
    [sessionId, who.email ?? "owner@example.com", who.name ?? "Owner", csrf],
  );
  return { sessionId, csrf };
}
