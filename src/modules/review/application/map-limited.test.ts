import { describe, expect, it } from "vitest";
import { mapLimited } from "./map-limited";

describe("mapLimited", () => {
  it("keeps the input order whatever order the calls finish in", async () => {
    const delays = [5, 1, 3, 0, 2];
    const result = await mapLimited(delays, 2, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms * 10;
    });
    expect(result).toEqual([50, 10, 30, 0, 20]);
  });

  it("maps nothing to nothing", async () => {
    expect(await mapLimited([], 5, () => Promise.resolve(1))).toEqual([]);
  });

  it("rejects with the first failure", async () => {
    await expect(
      mapLimited([1, 2, 3], 2, (n) =>
        n === 2 ? Promise.reject(new Error("lookup failed")) : Promise.resolve(n),
      ),
    ).rejects.toThrow("lookup failed");
  });
});
