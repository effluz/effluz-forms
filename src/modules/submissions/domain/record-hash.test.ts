import { describe, expect, it } from "vitest";
import { recordHash, sha256Hex } from "./record-hash";

describe("sha256Hex", () => {
  it("matches the published SHA-256 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    // Longer than one 64-byte block.
    expect(sha256Hex("a".repeat(1000))).toBe(
      "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
    );
  });
});

describe("recordHash", () => {
  it("is the first 12 hex characters of the id's SHA-256, never the id", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(recordHash(id)).toBe("11e594f48195");
    expect(recordHash(id)).not.toContain("0000");
  });
});
