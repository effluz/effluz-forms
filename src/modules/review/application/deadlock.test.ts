import { describe, expect, it } from "vitest";
import { withDeadlockRetry } from "./deadlock";

const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });

describe("withDeadlockRetry", () => {
  it("retries once when Postgres reports a deadlock", async () => {
    let calls = 0;
    const result = await withDeadlockRetry(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(deadlock()) : Promise.resolve("done");
    });
    expect(result).toBe("done");
    expect(calls).toBe(2);
  });

  it("gives up after the second deadlock", async () => {
    let calls = 0;
    await expect(
      withDeadlockRetry(() => {
        calls += 1;
        return Promise.reject(deadlock());
      }),
    ).rejects.toMatchObject({ code: "40P01" });
    expect(calls).toBe(2);
  });

  it("does not retry any other failure", async () => {
    let calls = 0;
    await expect(
      withDeadlockRetry(() => {
        calls += 1;
        return Promise.reject(Object.assign(new Error("unique"), { code: "23505" }));
      }),
    ).rejects.toThrow("unique");
    expect(calls).toBe(1);
  });
});
