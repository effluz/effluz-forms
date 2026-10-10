import { describe, expect, it } from "vitest";
import { clientIp, forbidden, redirectTo, signInPath } from "./http";

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
  it("is an uncached HTML 403 with the given page", async () => {
    const res = forbidden("<p>x</p>");
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("<p>x</p>");
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
