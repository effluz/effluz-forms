import { describe, expect, it } from "vitest";
import {
  ATTEMPT_COOKIE,
  attemptCookie,
  clearedCookie,
  readCookie,
  retryCookie,
  RETRY_COOKIE,
  sessionCookie,
} from "./cookies";

describe("sessionCookie", () => {
  it("scopes the session cookie to /admin, HttpOnly, SameSite=Lax, with Secure when asked", () => {
    expect(sessionCookie("s", "v", { secure: true, maxAgeSeconds: 10 })).toBe(
      "s=v; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=10; Secure",
    );
  });

  it("omits Secure when not asked", () => {
    expect(sessionCookie("s", "v", { secure: false, maxAgeSeconds: 10 })).toBe(
      "s=v; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=10",
    );
  });

  it("refuses a value that would inject cookie attributes", () => {
    expect(() => sessionCookie("s", "v; Path=/", { secure: false, maxAgeSeconds: 10 })).toThrow();
  });
});

describe("attemptCookie", () => {
  it("is named effluz_signin and scoped to /admin/auth for ten minutes", () => {
    expect(ATTEMPT_COOKIE).toBe("effluz_signin");
    expect(attemptCookie("a-1", false)).toBe(
      "effluz_signin=a-1; Path=/admin/auth; HttpOnly; SameSite=Lax; Max-Age=600",
    );
    expect(attemptCookie("a-1", true)).toBe(
      "effluz_signin=a-1; Path=/admin/auth; HttpOnly; SameSite=Lax; Max-Age=600; Secure",
    );
  });
});

describe("retryCookie", () => {
  it("marks one automatic restart on the attempt cookie's path", () => {
    expect(retryCookie(false)).toBe(
      `${RETRY_COOKIE}=1; Path=/admin/auth; HttpOnly; SameSite=Lax; Max-Age=600`,
    );
  });
});

describe("clearedCookie", () => {
  it("expires the cookie at once on the session path by default", () => {
    expect(clearedCookie("s", false)).toBe("s=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0");
    expect(clearedCookie("s", true)).toBe(
      "s=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    );
  });

  it("clears on another path when given one, since a cookie is keyed by its path", () => {
    expect(clearedCookie(ATTEMPT_COOKIE, false, "/admin/auth")).toBe(
      "effluz_signin=; Path=/admin/auth; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });
});

describe("readCookie", () => {
  it("finds a cookie by name in a Cookie header", () => {
    expect(readCookie("a=1; s=v; b=2", "s")).toBe("v");
    expect(readCookie("s=v", "s")).toBe("v");
  });

  it("returns null when the header or the cookie is absent or empty", () => {
    expect(readCookie(null, "s")).toBeNull();
    expect(readCookie("", "s")).toBeNull();
    expect(readCookie("a=1; ss=v", "s")).toBeNull();
    expect(readCookie("s=", "s")).toBeNull();
  });

  it("keeps an equals sign inside the value", () => {
    expect(readCookie("s=a=b", "s")).toBe("a=b");
  });
});
