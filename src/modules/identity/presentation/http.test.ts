import { describe, expect, it } from "vitest";
import { clientIp, forbidden, redirectTo, returnPathFromReferer, signInPath } from "./http";

const BASE = "https://forms.example.com";

describe("redirectTo", () => {
  it("is an uncached 302 with the Location and every Set-Cookie header", () => {
    const res = redirectTo("/admin", ["a=1; Path=/admin", "b=; Path=/admin/auth; Max-Age=0"]);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.getSetCookie()).toEqual([
      "a=1; Path=/admin",
      "b=; Path=/admin/auth; Max-Age=0",
    ]);
  });
});

describe("forbidden", () => {
  it("is an uncached 403", () => {
    const res = forbidden();
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for value, trimmed", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
  });

  it("is null without the header or with an empty first value", () => {
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ "x-forwarded-for": " , 10.0.0.1" }))).toBeNull();
  });
});

describe("signInPath", () => {
  it("encodes the return path", () => {
    expect(signInPath("/admin/forms")).toBe("/admin/auth/signin?returnTo=%2Fadmin%2Fforms");
  });
});

describe("returnPathFromReferer", () => {
  it("keeps a same-origin admin pathname", () => {
    expect(returnPathFromReferer(`${BASE}/admin/forms/1?tab=share`, BASE)).toBe("/admin/forms/1");
    expect(returnPathFromReferer(`${BASE}/admin`, BASE)).toBe("/admin");
  });

  it("falls back to /admin for anything else", () => {
    expect(returnPathFromReferer(null, BASE)).toBe("/admin");
    expect(returnPathFromReferer("not a url", BASE)).toBe("/admin");
    expect(returnPathFromReferer(`${BASE}/forms/a`, BASE)).toBe("/admin");
    expect(returnPathFromReferer(`${BASE}/administrator`, BASE)).toBe("/admin");
    expect(returnPathFromReferer("https://evil.example/admin/forms", BASE)).toBe("/admin");
  });

  it("never returns to the auth pages, which would land a fresh session on a signed-out page", () => {
    expect(returnPathFromReferer(`${BASE}/admin/auth/signed-out`, BASE)).toBe("/admin");
    expect(returnPathFromReferer(`${BASE}/admin/auth`, BASE)).toBe("/admin");
  });
});
