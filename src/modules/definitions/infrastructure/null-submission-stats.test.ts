import { describe, expect, it } from "vitest";
import { asKey } from "@/shared/domain/form-model";
import type { SubmissionStats } from "../application/ports/submission-stats";
import { NullSubmissionStats } from "./null-submission-stats";

describe("NullSubmissionStats", () => {
  const stats: SubmissionStats = new NullSubmissionStats();
  const now = new Date("2026-10-10T12:00:00.000Z");

  it("reports no submissions for every form asked", async () => {
    const summary = await stats.summary(["a", "b"]);
    expect(summary.get("a")).toEqual({ total: 0, lastReceivedAt: null });
    expect(summary.get("b")).toEqual({ total: 0, lastReceivedAt: null });
    expect(summary.size).toBe(2);
  });

  it("counts nothing received after or older than a date", async () => {
    expect(await stats.countReceivedAfter("a", now)).toBe(0);
    expect(await stats.countOlderThan("a", 12, now)).toBe(0);
  });

  it("counts no answers for any field key", async () => {
    const key = asKey("f_0a1b2c3d");
    expect((await stats.answerCounts("a", [key])).get(key)).toBe(0);
    expect((await stats.answerCounts("a", [])).size).toBe(0);
  });

  it("has no submissions at all", async () => {
    expect(await stats.hasAny("a")).toBe(false);
  });
});
