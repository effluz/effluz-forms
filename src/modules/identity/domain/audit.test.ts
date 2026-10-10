import { describe, expect, it } from "vitest";
import { assertNoPersonalData, auditActions } from "./audit";

describe("assertNoPersonalData", () => {
  it("accepts details without addresses", () => {
    expect(() => {
      assertNoPersonalData({ domain: "gmail.com", attempts: 2, ok: false });
    }).not.toThrow();
  });

  it("accepts missing details", () => {
    expect(() => {
      assertNoPersonalData(undefined);
    }).not.toThrow();
  });

  it("rejects a string value containing an address", () => {
    expect(() => {
      assertNoPersonalData({ who: "ana@example.com" });
    }).toThrow(/personal data/);
  });
});

describe("auditActions", () => {
  it("lists the identity actions", () => {
    expect(auditActions).toEqual([
      "sign_in",
      "sign_in_rejected",
      "sign_out",
      "session_expired",
      "sessions_revoked",
    ]);
  });
});
