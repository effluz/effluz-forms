import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./with-timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("resolves to the value when the promise settles in time, and clears its timer", async () => {
    vi.useFakeTimers();
    const result = await withTimeout(Promise.resolve("done"), 3_000, "fallback");
    expect(result).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves to the fallback when the promise does not settle in time", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<boolean>(() => undefined), 3_000, false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates a rejection and still clears its timer", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.reject(new Error("boom")), 3_000, null)).rejects.toThrow(
      "boom",
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
