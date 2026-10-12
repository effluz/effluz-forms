import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { PgSubmissionRepository } from "@/modules/submissions/infrastructure/pg-submission-repository";
import { PgSubmissionStats } from "@/modules/submissions/infrastructure/pg-submission-stats";
import { asKey } from "@/shared/domain/form-model";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "./factories";

describe("PgSubmissionStats", () => {
  const pool = testPool();
  const stats = new PgSubmissionStats(pool);
  const repo = new PgSubmissionRepository(pool);
  const uow = new PgUnitOfWorkFactory(pool);
  beforeEach(() => truncateAll(pool));

  it("answers the figures definitions asks for", async () => {
    const { formId, versionId } = await seedPublishedForm(pool);
    const { formId: other } = await seedPublishedForm(pool);
    const at = (iso: string, n: number, answers: Record<string, unknown>) =>
      uow.run((u) =>
        repo.insert(u, {
          id: randomUUID(),
          formId,
          versionId,
          locale: "en",
          answers,
          consent: null,
          receivedAt: new Date(iso),
          reference: `ST-000${String(n)}`,
          submitToken: randomUUID(),
        }),
      );
    await at("2025-09-01T00:00:00Z", 1, { f_name: "A" });
    await at("2026-10-01T00:00:00Z", 2, { f_name: "B", f_email: "b@example.com" });
    await at("2026-10-09T00:00:00Z", 3, { f_name: "C" });
    const summary = await stats.summary([formId, other, "not-a-uuid"]);
    expect(summary.get(formId)).toEqual({
      total: 3,
      lastReceivedAt: new Date("2026-10-09T00:00:00Z"),
    });
    expect(summary.get(other)).toEqual({ total: 0, lastReceivedAt: null });
    expect(summary.get("not-a-uuid")).toEqual({ total: 0, lastReceivedAt: null });
    expect(await stats.countReceivedAfter(formId, new Date("2026-09-30T00:00:00Z"))).toBe(2);
    expect(await stats.countOlderThan(formId, 12, new Date("2026-10-10T00:00:00Z"))).toBe(1);
    const keys = ["f_name", "f_email", "f_missing"].map(asKey);
    expect(await stats.answerCounts(formId, keys)).toEqual(
      new Map([
        ["f_name", 3],
        ["f_email", 1],
        ["f_missing", 0],
      ]),
    );
    expect(await stats.hasAny(formId)).toBe(true);
    expect(await stats.hasAny(other)).toBe(false);
  });

  it("counts months back from now in UTC, whatever the session's time zone", async () => {
    const { formId, versionId } = await seedPublishedForm(pool);
    await uow.run((u) =>
      repo.insert(u, {
        id: randomUUID(),
        formId,
        versionId,
        locale: "en",
        answers: {},
        consent: null,
        receivedAt: new Date("2026-02-28T00:00:00Z"),
        reference: "ST-0001",
        submitToken: randomUUID(),
      }),
    );
    // In UTC one month before 2026-03-30T12:00Z is 2026-02-28T12:00Z, so the submission is
    // older. At UTC+14 the local date is already the 31st, giving 2026-02-27T12:00Z.
    const client = await pool.connect();
    try {
      await client.query("set time zone 'Pacific/Kiritimati'");
      const local = new PgSubmissionStats(client as unknown as Pool);
      expect(await local.countOlderThan(formId, 1, new Date("2026-03-30T12:00:00Z"))).toBe(1);
    } finally {
      await client.query("reset time zone");
      client.release();
    }
  });

  it("gives zero figures for a form id that is not a UUID", async () => {
    expect(await stats.countReceivedAfter("nope", new Date())).toBe(0);
    expect(await stats.countOlderThan("nope", 12, new Date())).toBe(0);
    expect(await stats.answerCounts("nope", [asKey("f_name")])).toEqual(new Map([["f_name", 0]]));
    expect(await stats.hasAny("nope")).toBe(false);
  });
});
