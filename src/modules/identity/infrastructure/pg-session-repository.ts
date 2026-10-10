import type { Pool } from "pg";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { SessionRepository } from "../application/ports/session-repository";
import type { Session } from "../domain/session";
import { isUuid } from "./uuid";

interface SessionRow {
  id: string;
  email: string;
  name: string;
  csrf_token: string;
  created_at: Date;
  last_seen_at: Date;
}

/**
 * Postgres adapter for admin sessions; see specs/system/security.md, "Sessions".
 * Ids come from cookies, so one that is not a UUID names no session.
 */
export class PgSessionRepository implements SessionRepository {
  constructor(private readonly pool: Pool) {}

  async create(uow: UnitOfWork, session: Session): Promise<void> {
    await txOf(uow).client.query(
      `insert into admin_session (id, email, name, csrf_token, created_at, updated_at, last_seen_at)
       values ($1, $2, $3, $4, $5, $5, $6)`,
      [
        session.id,
        session.email,
        session.name,
        session.csrfToken,
        session.createdAt,
        session.lastSeenAt,
      ],
    );
  }

  async findById(id: string): Promise<Session | null> {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query<SessionRow>(
      `select id, email, name, csrf_token, created_at, last_seen_at
         from admin_session where id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      csrfToken: row.csrf_token,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  async touch(id: string, lastSeenAt: Date): Promise<void> {
    if (!isUuid(id)) return;
    await this.pool.query(
      "update admin_session set last_seen_at = $2, updated_at = now() where id = $1",
      [id, lastSeenAt],
    );
  }

  async delete(uow: UnitOfWork, id: string): Promise<void> {
    if (!isUuid(id)) return;
    await txOf(uow).client.query("delete from admin_session where id = $1", [id]);
  }

  async deleteAllForEmail(uow: UnitOfWork, email: string): Promise<number> {
    const res = await txOf(uow).client.query("delete from admin_session where email = $1", [email]);
    return res.rowCount ?? 0;
  }
}
