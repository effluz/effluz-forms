import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GoogleOidcAdmin } from "@/modules/identity/infrastructure/google-oidc";
import { startFakeIssuer, type FakeIssuer } from "../../fakes/oidc-issuer";

let issuer: FakeIssuer;
beforeAll(async () => {
  issuer = await startFakeIssuer();
});
afterAll(() => issuer.close());

const redirectUri = "http://localhost:3000/admin/auth/callback";
function adapter() {
  return new GoogleOidcAdmin({
    issuer: issuer.issuer,
    clientId: issuer.clientId,
    clientSecret: issuer.clientSecret,
    allowedHostedDomain: "example.com",
  });
}

/** Follows the authorization URL against the fake issuer and returns the callback URL it redirects to. */
async function authorize(url: string) {
  const res = await fetch(url, { redirect: "manual" });
  return res.headers.get("location") ?? "";
}

describe("GoogleOidcAdmin", () => {
  it("builds an authorization URL with PKCE, state, nonce and the hd hint", async () => {
    const start = await adapter().beginSignIn(redirectUri);
    const u = new URL(start.authorizationUrl);
    expect(u.origin).toBe(issuer.issuer);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe(start.state);
    expect(u.searchParams.get("nonce")).toBe(start.nonce);
    expect(u.searchParams.get("hd")).toBe("example.com");
    expect(u.searchParams.get("scope")).toContain("openid");
  });
  it("completes a sign-in and returns the claims", async () => {
    const a = adapter();
    const start = await a.beginSignIn(redirectUri);
    issuer.grant("code-1", {
      sub: "1",
      email: "ana@example.com",
      email_verified: true,
      hd: "example.com",
      name: "Ana",
    });
    const cb = await authorize(start.authorizationUrl + "&__code=code-1");
    const done = await a.completeSignIn({ url: cb }, { ...start, redirectUri });
    expect(done).toEqual({
      ok: true,
      claims: {
        email: "ana@example.com",
        emailVerified: true,
        hostedDomain: "example.com",
        name: "Ana",
      },
    });
  });
  it("passes through claims for a wrong domain unchanged; admission is the domain's job", async () => {
    const a = adapter();
    const start = await a.beginSignIn(redirectUri);
    issuer.grant("code-2", { sub: "2", email: "x@gmail.com", email_verified: true, name: "X" });
    const done = await a.completeSignIn(
      { url: await authorize(start.authorizationUrl + "&__code=code-2") },
      { ...start, redirectUri },
    );
    expect(done).toMatchObject({
      ok: true,
      claims: { email: "x@gmail.com", hostedDomain: undefined },
    });
  });
  it("rejects a state mismatch, a bad signature and a wrong nonce", async () => {
    const a = adapter();
    const start = await a.beginSignIn(redirectUri);
    issuer.grant("code-3", {
      sub: "3",
      email: "ana@example.com",
      email_verified: true,
      hd: "example.com",
    });
    const cb = await authorize(start.authorizationUrl + "&__code=code-3");
    expect(await a.completeSignIn({ url: cb }, { ...start, state: "other", redirectUri })).toEqual({
      ok: false,
      reason: "state_mismatch",
    });
    issuer.grant(
      "code-4",
      { sub: "4", email: "ana@example.com", email_verified: true, hd: "example.com" },
      { signWithWrongKey: true },
    );
    const start4 = await a.beginSignIn(redirectUri);
    expect(
      await a.completeSignIn(
        { url: await authorize(start4.authorizationUrl + "&__code=code-4") },
        { ...start4, redirectUri },
      ),
    ).toEqual({ ok: false, reason: "invalid_token" });
    issuer.grant(
      "code-5",
      { sub: "5", email: "ana@example.com", email_verified: true, hd: "example.com" },
      { omitNonce: true },
    );
    const start5 = await a.beginSignIn(redirectUri);
    expect(
      await a.completeSignIn(
        { url: await authorize(start5.authorizationUrl + "&__code=code-5") },
        { ...start5, redirectUri },
      ),
    ).toEqual({ ok: false, reason: "invalid_token" });
  });
  // Changed from exchange_failed: invalid_grant (unknown, expired or used code) is "stale".
  it("reports stale when the token endpoint answers invalid_grant", async () => {
    const a = adapter();
    const start = await a.beginSignIn(redirectUri);
    const cb = await authorize(start.authorizationUrl + "&__code=unknown-code");
    expect(await a.completeSignIn({ url: cb }, { ...start, redirectUri })).toEqual({
      ok: false,
      reason: "stale",
    });
  });
});
