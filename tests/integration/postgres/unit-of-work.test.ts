import { beforeEach, describe, expect, inject, it } from "vitest";
import { createPool } from "@/shared/infrastructure/postgres/pool";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

describe("PgUnitOfWork", () => {
  const pool = testPool();

  async function probeCount(): Promise<number> {
    const { rows } = await pool.query<{ n: number }>("select count(*)::int as n from uow_probe");
    return rows[0]?.n ?? -1;
  }

  beforeEach(async () => {
    await truncateAll(pool);
    await pool.query("create table if not exists uow_probe (v text)");
    await pool.query("delete from uow_probe");
  });

  it("commits writes made through the transaction client", async () => {
    const f = new PgUnitOfWorkFactory(pool);
    await f.run(async (uow) => {
      await txOf(uow).client.query("insert into uow_probe values ('a')");
    });
    expect(await probeCount()).toBe(1);
  });

  it("rolls back when the function throws and rethrows", async () => {
    const f = new PgUnitOfWorkFactory(pool);
    await expect(
      f.run(async (uow) => {
        await txOf(uow).client.query("insert into uow_probe values ('b')");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await probeCount()).toBe(0);
  });

  it("refuses a double commit and releases the client", async () => {
    const single = createPool(inject("databaseUrl"), { max: 1 });
    try {
      const f = new PgUnitOfWorkFactory(single);
      const uow = await f.begin();
      await uow.commit();
      await expect(uow.commit()).rejects.toThrow(/finished/);
      // A leaked client would leave a max-1 pool exhausted, so this would hang.
      await expect(f.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
    } finally {
      await single.end();
    }
  }, 10_000);

  it("txOf rejects a foreign unit of work", () => {
    expect(() =>
      txOf({ handle: {}, commit: () => Promise.resolve(), rollback: () => Promise.resolve() }),
    ).toThrow(/Postgres/);
  });
});
