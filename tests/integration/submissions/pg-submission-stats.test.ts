import { randomUUID } from "node:crypto";
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

  it("gives zero figures for a form id that is not a UUID", async () => {
    expect(await stats.countReceivedAfter("nope", new Date())).toBe(0);
    expect(await stats.countOlderThan("nope", 12, new Date())).toBe(0);
    expect(await stats.answerCounts("nope", [asKey("f_name")])).toEqual(new Map([["f_name", 0]]));
    expect(await stats.hasAny("nope")).toBe(false);
  });
});
