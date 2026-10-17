import { beforeEach, describe, expect, it } from "vitest";
import { PgDeliveryLog } from "@/modules/notifications/infrastructure/pg-delivery-log";
import { testPool, truncateAll } from "../db";

describe("PgDeliveryLog", () => {
  const pool = testPool();
  const log = new PgDeliveryLog(pool);
  const at = new Date("2026-10-10T12:00:00.000Z");

  beforeEach(() => truncateAll(pool));

  it("records a key once and finds it", async () => {
    expect(await log.find("email.staff_notification:s1")).toBeNull();
    await log.record("email.staff_notification:s1", "msg-1", at);
    await log.record("email.staff_notification:s1", "msg-2", at);
    expect(await log.find("email.staff_notification:s1")).toBe("msg-1");
    const { rows } = await pool.query<{ created_at: Date; updated_at: Date }>(
      "select created_at, updated_at from email_delivery",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.created_at).toEqual(at);
    expect(rows[0]?.updated_at).toEqual(at);
  });
});
