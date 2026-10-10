import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { Session } from "../../domain/session";

export interface SessionRepository {
  create(uow: UnitOfWork, session: Session): Promise<void>;
  /** Read path, no unit of work. */
  findById(id: string): Promise<Session | null>;
  /** Read-path write, no unit of work; idempotent. */
  touch(id: string, lastSeenAt: Date): Promise<void>;
  delete(uow: UnitOfWork, id: string): Promise<void>;
  /** Returns the number of sessions removed. */
  deleteAllForEmail(uow: UnitOfWork, email: string): Promise<number>;
}
