import { describe, expect, it } from "vitest";
import { admit } from "./staff-identity";

describe("admit", () => {
  it("admits a verified account on the allowed hosted domain", () => {
    expect(
      admit(
        { email: "Ana@Example.com", emailVerified: true, hostedDomain: "Example.com", name: "Ana" },
        "example.com",
      ),
    ).toEqual({ admitted: true, identity: { email: "ana@example.com", name: "Ana" } });
  });

  it("refuses an unverified email", () => {
    expect(
      admit(
        { email: "ana@example.com", emailVerified: false, hostedDomain: "example.com" },
        "example.com",
      ),
    ).toEqual({ admitted: false, reason: "unverified_email", attemptedDomain: "example.com" });
  });

  it("refuses a missing or different hosted domain and reports only the domain", () => {
    expect(admit({ email: "ana@gmail.com", emailVerified: true }, "example.com")).toEqual({
      admitted: false,
      reason: "wrong_domain",
      attemptedDomain: "gmail.com",
    });
    expect(
      admit(
        { email: "ana@other.com", emailVerified: true, hostedDomain: "other.com" },
        "example.com",
      ),
    ).toEqual({ admitted: false, reason: "wrong_domain", attemptedDomain: "other.com" });
  });

  it("refuses a missing email and falls back to the local part for a missing name", () => {
    expect(
      admit({ emailVerified: true, hostedDomain: "example.com" }, "example.com"),
    ).toMatchObject({ admitted: false, reason: "missing_email", attemptedDomain: "example.com" });
    expect(
      admit(
        { email: "ana.m@example.com", emailVerified: true, hostedDomain: "example.com" },
        "example.com",
      ),
    ).toMatchObject({ identity: { name: "ana.m" } });
  });

  it("falls back to the local part when the name claim is empty", () => {
    expect(
      admit(
        { email: "ana.m@example.com", emailVerified: true, hostedDomain: "example.com", name: "" },
        "example.com",
      ),
    ).toMatchObject({ identity: { name: "ana.m" } });
  });

  it("reports a null attempted domain when nothing identifies one", () => {
    expect(admit({}, "example.com")).toEqual({
      admitted: false,
      reason: "missing_email",
      attemptedDomain: null,
    });
  });

  it("checks verification before the hosted domain", () => {
    expect(admit({ email: "ana@gmail.com", emailVerified: false }, "example.com")).toEqual({
      admitted: false,
      reason: "unverified_email",
      attemptedDomain: "gmail.com",
    });
  });

  it("compares the allowed domain case-insensitively", () => {
    expect(
      admit(
        { email: "ana@example.com", emailVerified: true, hostedDomain: "example.com" },
        "Example.COM",
      ),
    ).toMatchObject({ admitted: true });
  });

  describe("blank domains never admit", () => {
    it("refuses every claim when the allowed domain is empty", () => {
      expect(admit({ email: "ana@gmail.com", emailVerified: true }, "")).toEqual({
        admitted: false,
        reason: "wrong_domain",
        attemptedDomain: "gmail.com",
      });
    });

    it("refuses every claim when the allowed domain is only whitespace", () => {
      expect(admit({ email: "ana@gmail.com", emailVerified: true }, "  ")).toEqual({
        admitted: false,
        reason: "wrong_domain",
        attemptedDomain: "gmail.com",
      });
      expect(
        admit({ email: "a@example.com", emailVerified: true, hostedDomain: "  " }, "  "),
      ).toMatchObject({ admitted: false, reason: "wrong_domain" });
    });

    it("refuses an empty hosted-domain claim", () => {
      expect(
        admit({ email: "ana@example.com", emailVerified: true, hostedDomain: "" }, "example.com"),
      ).toEqual({ admitted: false, reason: "wrong_domain", attemptedDomain: "example.com" });
    });

    it("refuses a whitespace hosted-domain claim", () => {
      expect(
        admit({ email: "ana@example.com", emailVerified: true, hostedDomain: "  " }, "example.com"),
      ).toEqual({ admitted: false, reason: "wrong_domain", attemptedDomain: "example.com" });
    });
  });

  it("treats an email without an at sign as a missing email", () => {
    expect(
      admit({ email: "ana", emailVerified: true, hostedDomain: "example.com" }, "example.com"),
    ).toEqual({ admitted: false, reason: "missing_email", attemptedDomain: "example.com" });
  });
});
