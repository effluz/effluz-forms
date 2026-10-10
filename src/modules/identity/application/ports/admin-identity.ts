import type { IdentityClaims } from "../../domain/staff-identity";

export interface SignInStart {
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** The full callback URL with its query string. */
export interface CallbackInput {
  url: string;
}

export type SignInCompletion =
  | { ok: true; claims: IdentityClaims }
  | {
      ok: false;
      /**
       * `stale`: the authorization code was expired, consumed or did not match the
       * attempt (nonce), so one restart is worth trying.
       */
      reason: "state_mismatch" | "stale" | "exchange_failed" | "invalid_token";
    };

/** The external identity provider used for admin sign-in. */
export interface AdminIdentity {
  beginSignIn(redirectUri: string): Promise<SignInStart>;
  completeSignIn(
    input: CallbackInput,
    expected: { state: string; nonce: string; codeVerifier: string; redirectUri: string },
  ): Promise<SignInCompletion>;
}
