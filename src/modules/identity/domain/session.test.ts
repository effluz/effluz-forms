import { describe, expect, it } from "vitest";
import { sessionCookieMaxAgeSeconds, sessionState, touch } from "./session";

const base = {
  id: "s",
  email: "a@example.com",
  name: "A",
  csrfToken: "c",
  createdAt: new Date("2026-10-10T00:00:00Z"),
  lastSeenAt: new Date("2026-10-10T00:00:00Z"),
};

describe("sessionState", () => {
  it("is active within both limits", () => {
    expect(sessionState(base, new Date("2026-10-10T07:59:00Z"))).toBe("active");
  });

  it("is still active exactly on the idle limit", () => {
    expect(sessionState(base, new Date("2026-10-10T08:00:00Z"))).toBe("active");
  });

  it("expires idle after 8 hours since last seen", () => {
    expect(sessionState(base, new Date("2026-10-10T08:00:01Z"))).toBe("idle_expired");
  });

  it("expires absolutely after 7 days since creation even when recently seen", () => {
    const s = touch(base, new Date("2026-10-16T23:00:00Z"));
    expect(sessionState(s, new Date("2026-10-17T00:00:01Z"))).toBe("absolute_expired");
  });

  it("is still active exactly on the absolute limit when recently seen", () => {
    const s = touch(base, new Date("2026-10-16T23:00:00Z"));
    expect(sessionState(s, new Date("2026-10-17T00:00:00Z"))).toBe("active");
  });

  it("reports absolute expiry when both limits have passed", () => {
    expect(sessionState(base, new Date("2026-10-20T00:00:00Z"))).toBe("absolute_expired");
  });

  it("touch returns a copy and leaves the original unchanged", () => {
    const t = touch(base, new Date("2026-10-10T01:00:00Z"));
    expect(t.lastSeenAt.toISOString()).toBe("2026-10-10T01:00:00.000Z");
    expect(base.lastSeenAt.toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });
});

describe("sessionCookieMaxAgeSeconds", () => {
  it("is the absolute lifetime of 7 days", () => {
    expect(sessionCookieMaxAgeSeconds()).toBe(7 * 24 * 60 * 60);
  });
});
