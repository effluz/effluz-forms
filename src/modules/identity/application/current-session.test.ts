import { describe, expect, it } from "vitest";
import { currentSession } from "./current-session";
import { makeDeps, type FakeIdentityDeps } from "./testing/fakes";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const META = { ip: "203.0.113.7" };

function seed(deps: FakeIdentityDeps, createdAt: Date, lastSeenAt: Date) {
  deps.sessions.seed({
    id: SESSION_ID,
    email: "staff@example.com",
    name: "Staff",
    csrfToken: "csrf-1",
    createdAt,
    lastSeenAt,
  });
}

describe("currentSession", () => {
  it("returns none without a cookie", async () => {
    const deps = makeDeps();
    expect(await currentSession(deps, { sessionId: null, meta: META })).toEqual({ state: "none" });
    expect(deps.audit.entries).toHaveLength(0);
  });

  it("returns none for an unknown id and audits nothing", async () => {
    const deps = makeDeps();
    expect(await currentSession(deps, { sessionId: "missing", meta: META })).toEqual({
      state: "none",
    });
    expect(deps.audit.entries).toHaveLength(0);
  });

  it("returns an active session and touches it when last seen more than 60 s ago", async () => {
    const deps = makeDeps();
    const start = deps.clock.now();
    seed(deps, start, start);
    deps.clock.advance(61_000);

    const result = await currentSession(deps, { sessionId: SESSION_ID, meta: META });

    expect(result.state).toBe("active");
    if (result.state !== "active") throw new Error("unreachable");
    expect(result.session.lastSeenAt).toEqual(deps.clock.now());
    const stored = await deps.sessions.findById(SESSION_ID);
    expect(stored?.lastSeenAt).toEqual(deps.clock.now());
    expect(deps.audit.entries).toHaveLength(0);
  });

  it("does not touch a session last seen 30 s ago", async () => {
    const deps = makeDeps();
    const start = deps.clock.now();
    seed(deps, start, start);
    deps.clock.advance(30_000);

    const result = await currentSession(deps, { sessionId: SESSION_ID, meta: META });

    expect(result.state).toBe("active");
    if (result.state !== "active") throw new Error("unreachable");
    expect(result.session.lastSeenAt).toEqual(start);
    expect((await deps.sessions.findById(SESSION_ID))?.lastSeenAt).toEqual(start);
  });

  it("deletes an idle-expired session and audits session_expired once", async () => {
    const deps = makeDeps();
    const start = deps.clock.now();
    seed(deps, start, start);
    deps.clock.advance(8 * 60 * 60 * 1000 + 1);

    const first = await currentSession(deps, { sessionId: SESSION_ID, meta: META });
    const second = await currentSession(deps, { sessionId: SESSION_ID, meta: META });

    expect(first).toEqual({ state: "expired", reason: "idle_expired" });
    expect(second).toEqual({ state: "none" });
    expect(deps.sessions.has(SESSION_ID)).toBe(false);
    expect(deps.audit.entries).toEqual([
      {
        entry: {
          action: "session_expired",
          actorEmail: "staff@example.com",
          targetId: SESSION_ID,
          ip: "203.0.113.7",
          details: { reason: "idle_expired" },
        },
        at: deps.clock.now(),
      },
    ]);
  });

  it("deletes an absolute-expired session and audits it with that reason", async () => {
    const deps = makeDeps();
    const start = deps.clock.now();
    seed(deps, start, start);
    deps.clock.advance(7 * 24 * 60 * 60 * 1000 + 1);
    // Keep it recently seen so only the absolute limit applies.
    await deps.sessions.touch(SESSION_ID, deps.clock.now());

    const result = await currentSession(deps, { sessionId: SESSION_ID, meta: META });

    expect(result).toEqual({ state: "expired", reason: "absolute_expired" });
    expect(deps.sessions.has(SESSION_ID)).toBe(false);
    expect(deps.audit.entries).toHaveLength(1);
    expect(deps.audit.entries[0]?.entry.details).toEqual({ reason: "absolute_expired" });
  });
});
