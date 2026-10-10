import type { Pool } from "pg";
import type { UnitOfWork, UnitOfWorkFactory } from "@/shared/application/ports/unit-of-work";
import { markTx } from "./tx";

export class PgUnitOfWorkFactory implements UnitOfWorkFactory {
  constructor(private readonly pool: Pool) {}

  async begin(): Promise<UnitOfWork> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
    } catch (e) {
      // The session state is unknown, so discard the connection instead of pooling it.
      client.release(e instanceof Error ? e : true);
      throw e;
    }
    let finished = false;
    const finish = async (sql: "commit" | "rollback"): Promise<void> => {
      if (finished) throw new Error("unit of work already finished");
      finished = true;
      try {
        await client.query(sql);
      } catch (e) {
        client.release(e instanceof Error ? e : true);
        throw e;
      }
      client.release();
    };
    return {
      handle: markTx(client),
      commit: () => finish("commit"),
      rollback: () => finish("rollback"),
    };
  }

  async run<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    const uow = await this.begin();
    try {
      const result = await fn(uow);
      await uow.commit();
      return result;
    } catch (e) {
      // Never let a rollback failure mask the original error.
      await uow.rollback().catch(() => undefined);
      throw e;
    }
  }
}
