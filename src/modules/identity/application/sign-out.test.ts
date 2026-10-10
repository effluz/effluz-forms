import { describe, expect, it } from "vitest";
import { constantTimeEqual, signOut } from "./sign-out";
import { makeDeps, type FakeIdentityDeps } from "./testing/fakes";

const META = { ip: "203.0.113.7" };

function seed(deps: FakeIdentityDeps) {
  const now = deps.clock.now();
  deps.sessions.seed({
    id: "session-1",
    email: "staff@example.com",
    name: "Staff",
    csrfToken: "csrf-token-1",
    createdAt: now,
    lastSeenAt: now,
  });
}

describe("signOut", () => {
  it("deletes the session and audits sign_out when the token matches", async () => {
    const deps = makeDeps();
    seed(deps);

    const result = await signOut(deps, {
      sessionId: "session-1",
      csrfToken: "csrf-token-1",
      meta: META,
    });

    expect(result).toBe("signed_out");
    expect(deps.sessions.has("session-1")).toBe(false);
    expect(deps.audit.entries).toEqual([
      {
        entry: {
          action: "sign_out",
          actorEmail: "staff@example.com",
          targetId: "session-1",
          ip: "203.0.113.7",
        },
        at: deps.clock.now(),
      },
    ]);
  });

  it("returns csrf_mismatch for a wrong token and leaves the session and audit untouched", async () => {
    const deps = makeDeps();
    seed(deps);

    const result = await signOut(deps, {
      sessionId: "session-1",
      csrfToken: "csrf-token-2",
      meta: META,
    });

    expect(result).toBe("csrf_mismatch");
    expect(deps.sessions.has("session-1")).toBe(true);
    expect(deps.audit.entries).toHaveLength(0);
  });

  it("treats an expired session as gone: deletes it, audits session_expired, returns no_session", async () => {
    const deps = makeDeps();
    seed(deps);
    deps.clock.advance(8 * 60 * 60 * 1000 + 1);

    const result = await signOut(deps, {
      sessionId: "session-1",
      csrfToken: "csrf-token-1",
      meta: META,
    });

    expect(result).toBe("no_session");
    expect(deps.sessions.has("session-1")).toBe(false);
    expect(deps.audit.entries).toEqual([
      {
        entry: {
          action: "session_expired",
          actorEmail: "staff@example.com",
          targetId: "session-1",
          ip: "203.0.113.7",
          details: { reason: "idle_expired" },
        },
        at: deps.clock.now(),
      },
    ]);
  });

  it("returns no_session for an unknown session", async () => {
    const deps = makeDeps();
    const result = await signOut(deps, { sessionId: "nope", csrfToken: "x", meta: META });
    expect(result).toBe("no_session");
    expect(deps.audit.entries).toHaveLength(0);
  });
});

describe("constantTimeEqual", () => {
  it("is true for equal strings", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
  });

  it("is false for different strings of the same length", () => {
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
  });

  it("is false for different lengths, including a prefix", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("abcd", "abc")).toBe(false);
  });

  it("treats two empty strings as equal and empty versus non-empty as different", () => {
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("", "a")).toBe(false);
  });
});
