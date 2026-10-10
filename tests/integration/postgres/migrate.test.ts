import { describe, expect, it } from "vitest";
import { migrate } from "@/shared/infrastructure/postgres/migrate";
import { testPool } from "../db";

describe("migrate", () => {
  it("is idempotent and records applied ids", async () => {
    const pool = testPool();
    const probe = { id: "9001", name: "probe", sql: "create table probe_t (id int);" };
    try {
      const first = await migrate(pool, [probe]);
      expect(first.applied).toEqual(["9001"]);
      const second = await migrate(pool, [probe]);
      expect(second.applied).toEqual([]);
      const rows = await pool.query("select id from schema_migration where id = '9001'");
      expect(rows.rowCount).toBe(1);
    } finally {
      await pool.query(
        "drop table if exists probe_t; delete from schema_migration where id = '9001'",
      );
    }
  });

  it("applies a migration once when runners start concurrently", async () => {
    const pool = testPool();
    const probe = { id: "9003", name: "race", sql: "create table race_t (id int);" };
    try {
      const results = await Promise.all([migrate(pool, [probe]), migrate(pool, [probe])]);
      expect(results.flatMap((r) => r.applied)).toEqual(["9003"]);
    } finally {
      await pool.query(
        "drop table if exists race_t; delete from schema_migration where id = '9003'",
      );
    }
  });

  it("rolls back a failing migration and records nothing", async () => {
    const pool = testPool();
    await expect(
      migrate(pool, [{ id: "9002", name: "bad", sql: "create table ok_t (id int); select 1/0;" }]),
    ).rejects.toThrow();
    const regclass = await pool.query<{ t: string | null }>("select to_regclass('ok_t') as t");
    expect(regclass.rows[0]?.t).toBeNull();
    expect((await pool.query("select 1 from schema_migration where id = '9002'")).rowCount).toBe(0);
  });
});
