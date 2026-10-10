import { describe, expect, it } from "vitest";
import { sanitizeReturnTo, startSignIn } from "./start-sign-in";
import { makeDeps } from "./testing/fakes";

describe("startSignIn", () => {
  it("stores an attempt with the provider's state, nonce and verifier and returns the authorization url", async () => {
    const deps = makeDeps();
    const result = await startSignIn(deps, { returnTo: "/admin/forms/1" });

    expect(result.authorizationUrl).toBe(deps.identity.start.authorizationUrl);
    const stored = await deps.attempts.consume(result.attemptId, deps.clock.now());
    expect(stored).toEqual({
      id: result.attemptId,
      state: "state-1",
      nonce: "nonce-1",
      codeVerifier: "verifier-1",
      returnTo: "/admin/forms/1",
      createdAt: deps.clock.now(),
    });
  });

  it.each([
    ["/admin/forms/1", "/admin/forms/1"],
    ["https://evil.example/admin", "/admin"],
    ["//evil.example", "/admin"],
    ["/f/slug", "/admin"],
    ["/adminx", "/admin"],
    ["/admin/../f/slug", "/admin"],
    ["/admin/%2e%2e/f/slug", "/admin"],
    ["/admin%2Fx", "/admin"],
    ["/admin?tab=2", "/admin?tab=2"],
    ["/admin", "/admin"],
  ])("sanitizes returnTo %s to %s", async (given, expected) => {
    const deps = makeDeps();
    const { attemptId } = await startSignIn(deps, { returnTo: given });
    const stored = await deps.attempts.consume(attemptId, deps.clock.now());
    expect(stored?.returnTo).toBe(expected);
  });

  it("passes the callback under the public base url as the redirect uri", async () => {
    const deps = makeDeps();
    await startSignIn(deps, { returnTo: "/admin" });
    expect(deps.identity.beginCalls).toEqual(["https://forms.example.com/admin/auth/callback"]);
  });
});

describe("sanitizeReturnTo", () => {
  it("falls back to /admin for empty input", () => {
    expect(sanitizeReturnTo(null)).toBe("/admin");
    expect(sanitizeReturnTo(undefined)).toBe("/admin");
    expect(sanitizeReturnTo("")).toBe("/admin");
  });

  it("rejects backslashes, control characters and embedded schemes", () => {
    expect(sanitizeReturnTo("/admin\\evil")).toBe("/admin");
    expect(sanitizeReturnTo("/admin\n/x")).toBe("/admin");
    expect(sanitizeReturnTo("/admin?next=https://evil.example")).toBe("/admin");
  });

  it("rejects the auth routes, so sign-in never returns into itself", () => {
    for (const path of [
      "/admin/auth",
      "/admin/auth/",
      "/admin/auth/signin?returnTo=%2Fadmin",
      "/admin/auth/signed-out",
      "/admin/auth?x=1",
      "/admin/auth#top",
    ])
      expect(sanitizeReturnTo(path)).toBe("/admin");
    expect(sanitizeReturnTo("/admin/authors")).toBe("/admin/authors");
  });

  it("keeps a dotted name that is not a parent-directory segment", () => {
    expect(sanitizeReturnTo("/admin/a..b/c")).toBe("/admin/a..b/c");
  });
});
