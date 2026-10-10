import * as client from "openid-client";
import type {
  AdminIdentity,
  CallbackInput,
  SignInCompletion,
  SignInStart,
} from "../application/ports/admin-identity";
import type { IdentityClaims } from "../domain/staff-identity";

export interface GoogleOidcOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Sent as the `hd` hint only. Admission is decided from the claims by the domain. */
  allowedHostedDomain: string;
  /** Custom fetch used for every request to the issuer. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

type Refusal = "exchange_failed" | "invalid_token";

/** openid-client errors that mean the ID token itself is not acceptable. */
const INVALID_TOKEN_CODES = new Set<string>([
  // Also covers a malformed callback or token response, which therefore reports as
  // invalid_token; a failed signature check lands here too.
  "OAUTH_INVALID_RESPONSE",
  "OAUTH_JWT_CLAIM_COMPARISON_FAILED",
  "OAUTH_JWT_TIMESTAMP_CHECK_FAILED",
  "OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED",
  "OAUTH_KEY_SELECTION_FAILED",
  "OAUTH_PARSE_ERROR",
]);

function isLocalTestIssuer(issuer: string): boolean {
  try {
    const url = new URL(issuer);
    return (
      url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

/**
 * Maps whatever openid-client throws to a refusal reason. Nothing is
 * logged and no error detail leaves this function.
 */
function reasonFor(error: unknown): Refusal {
  if (error instanceof client.ClientError) {
    return error.code !== undefined && INVALID_TOKEN_CODES.has(error.code)
      ? "invalid_token"
      : "exchange_failed";
  }
  // ResponseBodyError, AuthorizationResponseError, WWWAuthenticateChallengeError,
  // network TypeErrors and everything else are token endpoint or transport failures.
  return "exchange_failed";
}

function claimsFrom(payload: client.IDToken): IdentityClaims {
  const text = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;
  return {
    email: text(payload["email"]),
    emailVerified:
      typeof payload["email_verified"] === "boolean" ? payload["email_verified"] : undefined,
    hostedDomain: text(payload["hd"]),
    name: text(payload["name"]),
  };
}

/**
 * Google OpenID Connect adapter for admin sign-in: authorization code flow with
 * PKCE, state and nonce. See specs/system/security.md, "Admin authentication",
 * and specs/decisions/0018-identity-implementation.md.
 *
 * openid-client does not verify the signature of an ID token received from the
 * token endpoint by default. `enableNonRepudiationChecks` turns that on: the
 * signature is then verified against the issuer's `jwks_uri`, and symmetric
 * algorithms are rejected. Issuer, audience, expiry and nonce are checked by the
 * library in the same call.
 */
export class GoogleOidcAdmin implements AdminIdentity {
  private discovered: Promise<client.Configuration> | null = null;

  constructor(private readonly options: GoogleOidcOptions) {}

  async beginSignIn(redirectUri: string): Promise<SignInStart> {
    const configuration = await this.discover();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const url = client.buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
      hd: this.options.allowedHostedDomain,
    });
    return { authorizationUrl: url.toString(), state, nonce, codeVerifier };
  }

  async completeSignIn(
    input: CallbackInput,
    expected: { state: string; nonce: string; codeVerifier: string; redirectUri: string },
  ): Promise<SignInCompletion> {
    let callback: URL;
    try {
      callback = new URL(input.url);
    } catch {
      return { ok: false, reason: "exchange_failed" };
    }
    // Checked before the library so a forged callback never reaches the token endpoint.
    if (callback.searchParams.get("state") !== expected.state) {
      return { ok: false, reason: "state_mismatch" };
    }
    // The user denied consent, or the issuer refused the request.
    if (callback.searchParams.has("error")) {
      return { ok: false, reason: "exchange_failed" };
    }

    try {
      const configuration = await this.discover();
      // The token request must carry the redirect URI sent at authorization, not whatever
      // origin and path this request arrived on behind the reverse proxy.
      const current = new URL(expected.redirectUri);
      current.search = callback.search;
      const tokens = await client.authorizationCodeGrant(configuration, current, {
        pkceCodeVerifier: expected.codeVerifier,
        expectedNonce: expected.nonce,
        expectedState: expected.state,
      });
      const idToken = tokens.claims();
      if (idToken === undefined) return { ok: false, reason: "invalid_token" };
      return { ok: true, claims: claimsFrom(idToken) };
    } catch (error) {
      return { ok: false, reason: reasonFor(error) };
    }
  }

  /** Discovery runs once, lazily. A failed attempt is forgotten so the next call retries. */
  private discover(): Promise<client.Configuration> {
    if (this.discovered === null) {
      const attempt = this.runDiscovery();
      this.discovered = attempt;
      attempt.catch(() => {
        if (this.discovered === attempt) this.discovered = null;
      });
    }
    return this.discovered;
  }

  private async runDiscovery(): Promise<client.Configuration> {
    const { issuer, clientId, clientSecret, fetch: injectedFetch } = this.options;
    const discoveryOptions: client.DiscoveryRequestOptions = {};
    if (isLocalTestIssuer(issuer)) {
      // Plain HTTP is allowed only for the local test issuer; production issuers are https.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      discoveryOptions.execute = [client.allowInsecureRequests];
    }
    if (injectedFetch !== undefined) {
      discoveryOptions[client.customFetch] = (url, init) => injectedFetch(url, init as RequestInit);
    }
    const configuration = await client.discovery(
      new URL(issuer),
      clientId,
      clientSecret,
      undefined,
      discoveryOptions,
    );
    client.enableNonRepudiationChecks(configuration);
    return configuration;
  }
}
