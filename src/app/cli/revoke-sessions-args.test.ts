import { describe, expect, it } from "vitest";
import { parseArgs } from "./revoke-sessions-args";

describe("parseArgs", () => {
  it("accepts one address and normalizes it", () => {
    expect(parseArgs(["  Someone@Example.com "])).toEqual({
      ok: true,
      email: "someone@example.com",
    });
  });

  it.each([
    ["no argument", []],
    ["two arguments", ["a@example.com", "b@example.com"]],
    ["no at sign", ["someone"]],
    ["empty local part", ["@example.com"]],
    ["empty domain", ["someone@"]],
    ["blank argument", ["   "]],
  ])("rejects %s with a usage message", (_name, argv) => {
    const result = parseArgs(argv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/^usage: /);
  });

  it("never echoes the argument in the message", () => {
    const result = parseArgs(["not-an-address-secret"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain("secret");
  });
});
