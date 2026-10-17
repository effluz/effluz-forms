import { describe, expect, it } from "vitest";
import { rendererCsp } from "./csp";

describe("rendererCsp", () => {
  it("allows only this origin's scripts carrying the nonce, and no framing", () => {
    const policy = rendererCsp("abc123", false);
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("img-src 'self' blob: data:");
    expect(policy).not.toContain("unsafe-eval");
    expect(rendererCsp("abc123", true)).toContain("'unsafe-eval'");
  });
});
