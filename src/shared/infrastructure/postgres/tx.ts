import type { PoolClient } from "pg";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";

/** What a Postgres adapter needs to join a unit of work's transaction. */
export interface TxContext {
  client: PoolClient;
}

const TX = Symbol.for("effluz.pg.tx");

/** Builds the opaque handle a Postgres unit of work exposes. */
export function markTx(client: PoolClient): TxContext & { [TX]: true } {
  return { client, [TX]: true };
}

/** Recovers the transaction client from a unit of work; throws if it is not a Postgres one. */
export function txOf(uow: UnitOfWork): TxContext {
  const h = uow.handle as { [TX]?: true; client?: PoolClient } | null;
  if (!h || h[TX] !== true || !h.client) {
    throw new Error("unit of work is not a Postgres transaction");
  }
  return { client: h.client };
}
