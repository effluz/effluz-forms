import { describe, expect, it } from "vitest";
import { operatorEmail, parseArgs } from "./revoke-sessions-args";

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
    ["a second at sign", ["someone@example@com"]],
    ["inner whitespace", ["some one@example.com"]],
    ["an inner tab", ["someone@example\t.com"]],
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

describe("operatorEmail", () => {
  it("reads OPERATOR_EMAIL trimmed and treats a blank value as unset", () => {
    expect(operatorEmail({ OPERATOR_EMAIL: " ops@example.com " })).toBe("ops@example.com");
    expect(operatorEmail({ OPERATOR_EMAIL: "   " })).toBeNull();
    expect(operatorEmail({ OPERATOR_EMAIL: "" })).toBeNull();
    expect(operatorEmail({})).toBeNull();
  });
});
