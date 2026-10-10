import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GoogleOidcAdmin } from "@/modules/identity/infrastructure/google-oidc";
import type { SignInCompletion } from "@/modules/identity/application/ports/admin-identity";
import { startFakeIssuer, type FakeIssuer, type GrantOptions } from "../../fakes/oidc-issuer";

let issuer: FakeIssuer;
beforeAll(async () => {
  issuer = await startFakeIssuer();
});
afterEach(() => {
  issuer.failEndpoint("jwks", false);
  issuer.failEndpoint("discovery", false);
});
afterAll(() => issuer.close());

const redirectUri = "http://localhost:3000/admin/auth/callback";
const claims = { sub: "9", email: "ana@example.com", email_verified: true, hd: "example.com" };

function adapter(fetchImpl?: typeof fetch) {
  return new GoogleOidcAdmin({
    issuer: issuer.issuer,
    clientId: issuer.clientId,
    clientSecret: issuer.clientSecret,
    allowedHostedDomain: "example.com",
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

async function authorize(url: string) {
  const res = await fetch(url, { redirect: "manual" });
  return res.headers.get("location") ?? "";
}

/** Runs begin, authorize and complete against the fake issuer with one grant. */
async function signIn(
  code: string,
  grantOptions: GrantOptions = {},
  a: GoogleOidcAdmin = adapter(),
  callbackOrigin?: string,
): Promise<SignInCompletion> {
  const start = await a.beginSignIn(redirectUri);
  issuer.grant(code, claims, grantOptions);
  let callback = await authorize(`${start.authorizationUrl}&__code=${code}`);
  if (callbackOrigin !== undefined) {
    const original = new URL(callback);
    callback = `${callbackOrigin}${original.pathname}${original.search}`;
  }
  return a.completeSignIn({ url: callback }, { ...start, redirectUri });
}

const expected = { state: "s1", nonce: "n1", codeVerifier: "v1", redirectUri };

describe("GoogleOidcAdmin redirect URI", () => {
  it("exchanges the code with the configured redirect URI, not the callback's origin", async () => {
    const done = await signIn("redirect-1", {}, adapter(), "http://internal:3000");
    expect(done).toMatchObject({ ok: true, claims: { email: "ana@example.com" } });
  });
});

describe("GoogleOidcAdmin callback handling", () => {
  it("rejects a callback with no state before any token exchange", async () => {
    const a = adapter();
    const done = await a.completeSignIn({ url: `${redirectUri}?code=abc` }, expected);
    expect(done).toEqual({ ok: false, reason: "state_mismatch" });
  });

  it("maps an error parameter such as access_denied to exchange_failed", async () => {
    const a = adapter();
    const url = `${redirectUri}?error=access_denied&state=${expected.state}`;
    expect(await a.completeSignIn({ url }, expected)).toEqual({
      ok: false,
      reason: "exchange_failed",
    });
  });

  it("maps an unparseable callback URL to exchange_failed", async () => {
    expect(await adapter().completeSignIn({ url: "not a url" }, expected)).toEqual({
      ok: false,
      reason: "exchange_failed",
    });
  });
});

describe("GoogleOidcAdmin discovery", () => {
  it("reports exchange_failed when discovery fails, then recovers on the next call", async () => {
    const a = adapter();
    issuer.failEndpoint("discovery", true);
    const url = `${redirectUri}?code=abc&state=${expected.state}`;
    expect(await a.completeSignIn({ url }, expected)).toEqual({
      ok: false,
      reason: "exchange_failed",
    });
    issuer.failEndpoint("discovery", false);
    // Same instance: the rejected discovery must not have been cached.
    const done = await signIn("discovery-1", {}, a);
    expect(done).toMatchObject({ ok: true });
  });

  it("uses the injected fetch for requests to the issuer", async () => {
    let calls = 0;
    const counting: typeof fetch = (input, init) => {
      calls += 1;
      return fetch(input, init);
    };
    const done = await signIn("fetch-1", {}, adapter(counting));
    expect(done).toMatchObject({ ok: true });
    // Discovery, token endpoint and signing keys.
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});

describe("GoogleOidcAdmin ID token validation", () => {
  it("reports exchange_failed when the signing keys cannot be fetched (HTTP 500)", async () => {
    // A transport failure of the issuer, not evidence that the token is forged.
    const a = adapter();
    const start = await a.beginSignIn(redirectUri);
    issuer.grant("jwks-1", claims);
    issuer.failEndpoint("jwks", true);
    const callback = await authorize(`${start.authorizationUrl}&__code=jwks-1`);
    expect(await a.completeSignIn({ url: callback }, { ...start, redirectUri })).toEqual({
      ok: false,
      reason: "exchange_failed",
    });
  });

  it("rejects an expired token", async () => {
    expect(await signIn("expired-1", { expiresIn: -3600 })).toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });

  it("rejects a token for another audience", async () => {
    expect(await signIn("aud-1", { audience: "another-client" })).toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });

  it("rejects a token from another issuer", async () => {
    expect(await signIn("iss-1", { issuer: "https://accounts.example.net" })).toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });
});
