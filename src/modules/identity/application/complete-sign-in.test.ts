import { describe, expect, it } from "vitest";
import { completeSignIn } from "./complete-sign-in";
import { makeDeps, type FakeIdentityDeps } from "./testing/fakes";

const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const META = { ip: "203.0.113.7" };
const CALLBACK = "https://forms.example.com/admin/auth/callback?code=c&state=state-1";

function seedAttempt(deps: FakeIdentityDeps, returnTo = "/admin/forms/1") {
  deps.attempts.seed({
    id: ATTEMPT_ID,
    state: "state-1",
    nonce: "nonce-1",
    codeVerifier: "verifier-1",
    returnTo,
    createdAt: deps.clock.now(),
  });
}

function workspaceClaims() {
  return {
    ok: true as const,
    claims: {
      email: "Staff.Member@Effluz.com",
      emailVerified: true,
      hostedDomain: "effluz.com",
      name: "Staff Member",
    },
  };
}

describe("completeSignIn", () => {
  it("creates a session, audits sign_in and returns the attempt's returnTo", async () => {
    const deps = makeDeps();
    seedAttempt(deps);
    deps.identity.script(workspaceClaims());

    const result = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      callbackUrl: CALLBACK,
      meta: META,
    });

    expect(result.outcome).toBe("signed_in");
    if (result.outcome !== "signed_in") throw new Error("unreachable");
    const now = deps.clock.now();
    expect(result.returnTo).toBe("/admin/forms/1");
    expect(result.session.email).toBe("staff.member@effluz.com");
    expect(result.session.name).toBe("Staff Member");
    expect(result.session.createdAt).toEqual(now);
    expect(result.session.lastSeenAt).toEqual(now);
    expect(result.session.csrfToken).not.toBe("");
    expect(result.session.csrfToken).not.toBe(result.session.id);
    expect(await deps.sessions.findById(result.session.id)).toEqual(result.session);
    expect(deps.audit.entries).toEqual([
      {
        entry: {
          action: "sign_in",
          actorEmail: "staff.member@effluz.com",
          targetId: result.session.id,
          ip: "203.0.113.7",
        },
        at: now,
      },
    ]);
  });

  it("replaces the browser's previous session without auditing it", async () => {
    const deps = makeDeps();
    const previousId = "33333333-3333-4333-8333-333333333333";
    deps.sessions.seed({
      id: previousId,
      email: "staff.member@effluz.com",
      name: "Staff Member",
      csrfToken: "csrf-old",
      createdAt: deps.clock.now(),
      lastSeenAt: deps.clock.now(),
    });
    seedAttempt(deps);
    deps.identity.script(workspaceClaims());

    const result = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      previousSessionId: previousId,
      callbackUrl: CALLBACK,
      meta: META,
    });

    if (result.outcome !== "signed_in") throw new Error("expected signed_in");
    expect(deps.sessions.has(previousId)).toBe(false);
    expect(deps.sessions.all().map((s) => s.id)).toEqual([result.session.id]);
    expect(deps.audit.entries.map((e) => e.entry.action)).toEqual(["sign_in"]);
  });

  it.each([
    ["unknown", "44444444-4444-4444-8444-444444444444"],
    ["malformed", "gone"],
    ["absent", null],
  ])("signs in normally when the previous session id is %s", async (_name, previousId) => {
    const deps = makeDeps();
    seedAttempt(deps);
    deps.identity.script(workspaceClaims());
    const result = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      previousSessionId: previousId,
      callbackUrl: CALLBACK,
      meta: META,
    });
    expect(result.outcome).toBe("signed_in");
    expect(deps.sessions.all()).toHaveLength(1);
    expect(deps.audit.entries.map((e) => e.entry.action)).toEqual(["sign_in"]);
  });

  it("keeps the previous session when sign-in is denied", async () => {
    const deps = makeDeps();
    const previousId = "33333333-3333-4333-8333-333333333333";
    deps.sessions.seed({
      id: previousId,
      email: "staff.member@effluz.com",
      name: "Staff Member",
      csrfToken: "csrf-old",
      createdAt: deps.clock.now(),
      lastSeenAt: deps.clock.now(),
    });
    seedAttempt(deps);
    deps.identity.script({
      ok: true,
      claims: { email: "someone@gmail.com", emailVerified: true, hostedDomain: "gmail.com" },
    });
    const result = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      previousSessionId: previousId,
      callbackUrl: CALLBACK,
      meta: META,
    });
    expect(result).toEqual({ outcome: "denied" });
    expect(deps.sessions.has(previousId)).toBe(true);
  });

  it("passes the stored attempt secrets and the same redirect uri used at start", async () => {
    const deps = makeDeps();
    seedAttempt(deps);
    deps.identity.script(workspaceClaims());
    await completeSignIn(deps, { attemptId: ATTEMPT_ID, callbackUrl: CALLBACK, meta: META });

    expect(deps.identity.completeCalls).toEqual([
      {
        input: { url: CALLBACK },
        expected: {
          state: "state-1",
          nonce: "nonce-1",
          codeVerifier: "verifier-1",
          redirectUri: "https://forms.example.com/admin/auth/callback",
        },
      },
    ]);
  });

  it("returns retry for a second call with the same attempt and creates nothing", async () => {
    const deps = makeDeps();
    seedAttempt(deps);
    deps.identity.script(workspaceClaims());
    await completeSignIn(deps, { attemptId: ATTEMPT_ID, callbackUrl: CALLBACK, meta: META });
    deps.identity.script(workspaceClaims());

    const second = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      callbackUrl: CALLBACK,
      meta: META,
    });

    expect(second).toEqual({ outcome: "retry" });
    expect(deps.sessions.all()).toHaveLength(1);
    expect(deps.audit.entries).toHaveLength(1);
    expect(deps.identity.completeCalls).toHaveLength(1);
  });

  it("returns retry when there is no attempt cookie", async () => {
    const deps = makeDeps();
    const result = await completeSignIn(deps, {
      attemptId: null,
      callbackUrl: CALLBACK,
      meta: META,
    });
    expect(result).toEqual({ outcome: "retry" });
    expect(deps.identity.completeCalls).toHaveLength(0);
  });

  it("returns retry when the attempt has expired", async () => {
    const deps = makeDeps();
    seedAttempt(deps);
    deps.clock.advance(10 * 60 * 1000);
    const result = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      callbackUrl: CALLBACK,
      meta: META,
    });
    expect(result).toEqual({ outcome: "retry" });
    expect(deps.sessions.all()).toHaveLength(0);
  });

  it("denies a personal account, audits sign_in_rejected with the domain only", async () => {
    const deps = makeDeps();
    seedAttempt(deps);
    deps.identity.script({
      ok: true,
      claims: {
        email: "someone.private@gmail.com",
        emailVerified: true,
        hostedDomain: "gmail.com",
        name: "Someone",
      },
    });

    const result = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      callbackUrl: CALLBACK,
      meta: META,
    });

    expect(result).toEqual({ outcome: "denied" });
    expect(deps.sessions.all()).toHaveLength(0);
    expect(deps.audit.entries).toEqual([
      {
        entry: {
          action: "sign_in_rejected",
          actorEmail: null,
          targetId: null,
          ip: "203.0.113.7",
          details: { domain: "gmail.com" },
        },
        at: deps.clock.now(),
      },
    ]);
    expect(JSON.stringify(deps.audit.entries)).not.toContain("someone.private");
  });

  it("omits details when no domain could be determined", async () => {
    const deps = makeDeps();
    seedAttempt(deps);
    deps.identity.script({ ok: true, claims: { emailVerified: true } });

    const result = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      callbackUrl: CALLBACK,
      meta: { ip: null },
    });

    expect(result).toEqual({ outcome: "denied" });
    const [recorded] = deps.audit.entries;
    expect(recorded?.entry).toEqual({
      action: "sign_in_rejected",
      actorEmail: null,
      targetId: null,
      ip: null,
    });
    expect(recorded?.entry).not.toHaveProperty("details");
  });

  it("returns error and audits nothing when the token is invalid", async () => {
    const deps = makeDeps();
    seedAttempt(deps);
    deps.identity.script({ ok: false, reason: "invalid_token" });
    const result = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      callbackUrl: CALLBACK,
      meta: META,
    });
    expect(result).toEqual({ outcome: "error" });
    expect(deps.audit.entries).toHaveLength(0);
    expect(deps.sessions.all()).toHaveLength(0);
  });

  it("returns error and audits nothing when the code exchange fails", async () => {
    const deps = makeDeps();
    seedAttempt(deps);
    deps.identity.script({ ok: false, reason: "exchange_failed" });
    const result = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      callbackUrl: CALLBACK,
      meta: META,
    });
    expect(result).toEqual({ outcome: "error" });
    expect(deps.audit.entries).toHaveLength(0);
  });

  it("returns retry when the code is stale", async () => {
    const deps = makeDeps();
    seedAttempt(deps);
    deps.identity.script({ ok: false, reason: "stale" });
    const result = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      callbackUrl: CALLBACK,
      meta: META,
    });
    expect(result).toEqual({ outcome: "retry" });
    expect(deps.audit.entries).toHaveLength(0);
    expect(deps.sessions.all()).toHaveLength(0);
  });

  it("spends the attempt even when the exchange fails", async () => {
    const deps = makeDeps();
    seedAttempt(deps);
    deps.identity.script({ ok: false, reason: "invalid_token" });
    const first = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      callbackUrl: CALLBACK,
      meta: META,
    });
    const second = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      callbackUrl: CALLBACK,
      meta: META,
    });
    expect(first).toEqual({ outcome: "error" });
    expect(second).toEqual({ outcome: "retry" });
    expect(deps.identity.completeCalls).toHaveLength(1);
  });

  it("returns retry on a state mismatch", async () => {
    const deps = makeDeps();
    seedAttempt(deps);
    deps.identity.script({ ok: false, reason: "state_mismatch" });
    const result = await completeSignIn(deps, {
      attemptId: ATTEMPT_ID,
      callbackUrl: CALLBACK,
      meta: META,
    });
    expect(result).toEqual({ outcome: "retry" });
    expect(deps.audit.entries).toHaveLength(0);
  });
});
