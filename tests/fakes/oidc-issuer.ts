import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type CryptoKey } from "jose";

/**
 * A minimal OpenID Connect issuer for tests. It listens on 127.0.0.1 on an
 * ephemeral port and implements discovery, the JWKS, /authorize and /token.
 * Test tooling only: nothing under src/ may import it.
 */
export interface FakeIssuer {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Registers what the next token exchange will return for a given code. */
  grant(code: string, claims: Record<string, unknown>, opts?: GrantOptions): void;
  /** Makes one endpoint answer HTTP 500 until switched off again. */
  failEndpoint(endpoint: "jwks" | "discovery", failing: boolean): void;
  close(): Promise<void>;
}

export interface GrantOptions {
  signWithWrongKey?: boolean;
  omitNonce?: boolean;
  /** Puts this value in the `nonce` claim instead of the one from /authorize. */
  nonce?: string;
  /** Seconds until the ID token expires, from now. Negative values give an expired token. */
  expiresIn?: number;
  /** Overrides the `aud` claim (default: the client id). */
  audience?: string;
  /** Overrides the `iss` claim (default: this issuer). */
  issuer?: string;
}

interface Grant {
  claims: Record<string, unknown>;
  options: GrantOptions;
}

/** What was sent to /authorize, bound to the code issued for it. */
interface AuthorizationRequest {
  nonce: string | null;
  state: string | null;
  codeChallenge: string | null;
  redirectUri: string;
}

const KID = "fake-issuer-key";
const CLIENT_ID = "fake-client-id";
const CLIENT_SECRET = "fake-client-secret";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Accepts client authentication by HTTP Basic or by client_secret_post. */
function clientCredentials(
  req: IncomingMessage,
  form: URLSearchParams,
): { id: string | null; secret: string | null } {
  const header = req.headers.authorization;
  if (header?.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const split = decoded.indexOf(":");
    if (split >= 0) {
      return {
        id: decodeURIComponent(decoded.slice(0, split)),
        secret: decodeURIComponent(decoded.slice(split + 1)),
      };
    }
  }
  return { id: form.get("client_id"), secret: form.get("client_secret") };
}

export async function startFakeIssuer(): Promise<FakeIssuer> {
  const signing = await generateKeyPair("RS256", { extractable: true });
  const unpublished = await generateKeyPair("RS256");
  const publicJwk: JWK = {
    ...(await exportJWK(signing.publicKey)),
    kid: KID,
    alg: "RS256",
    use: "sig",
  };

  const grants = new Map<string, Grant>();
  const requests = new Map<string, AuthorizationRequest>();
  const failing = new Set<"jwks" | "discovery">();

  let issuer = "";

  async function idToken(grant: Grant, nonce: string | null): Promise<string> {
    const claims: Record<string, unknown> = { ...grant.claims };
    const { options } = grant;
    if (options.nonce !== undefined) claims["nonce"] = options.nonce;
    else if (nonce !== null && options.omitNonce !== true) claims["nonce"] = nonce;
    const key: CryptoKey =
      options.signWithWrongKey === true ? unpublished.privateKey : signing.privateKey;
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = options.expiresIn ?? 300;
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(options.issuer ?? issuer)
      .setAudience(options.audience ?? CLIENT_ID)
      .setIssuedAt(Math.min(now, now + expiresIn - 300))
      .setExpirationTime(now + expiresIn)
      .sign(key);
  }

  async function token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = new URLSearchParams(await readBody(req));
    const credentials = clientCredentials(req, form);
    if (credentials.id !== CLIENT_ID || credentials.secret !== CLIENT_SECRET) {
      sendJson(res, 401, { error: "invalid_client" });
      return;
    }
    const code = form.get("code") ?? "";
    const grant = grants.get(code);
    const request = requests.get(code);
    const verifier = form.get("code_verifier");
    const redirectMatches =
      request !== undefined && form.get("redirect_uri") === request.redirectUri;
    const challengeMatches =
      request?.codeChallenge == null ||
      (verifier !== null &&
        createHash("sha256").update(verifier).digest("base64url") === request.codeChallenge);
    if (
      form.get("grant_type") !== "authorization_code" ||
      !grant ||
      !request ||
      !challengeMatches ||
      !redirectMatches
    ) {
      sendJson(res, 400, { error: "invalid_grant" });
      return;
    }
    grants.delete(code);
    requests.delete(code);
    sendJson(res, 200, {
      access_token: "x",
      token_type: "bearer",
      expires_in: 3600,
      id_token: await idToken(grant, request.nonce),
    });
  }

  function authorize(url: URL, res: ServerResponse): void {
    const clientId = url.searchParams.get("client_id") ?? "";
    const redirectUri = url.searchParams.get("redirect_uri");
    if (clientId !== CLIENT_ID || !redirectUri) {
      sendJson(res, 400, { error: "invalid_request" });
      return;
    }
    const state = url.searchParams.get("state");
    // `__code` is a test-only convention: it picks which registered grant to return.
    const code = url.searchParams.get("__code") ?? "unspecified-code";
    requests.set(code, {
      nonce: url.searchParams.get("nonce"),
      state,
      codeChallenge: url.searchParams.get("code_challenge"),
      redirectUri,
    });
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    if (state !== null) target.searchParams.set("state", state);
    res.writeHead(302, { location: target.toString() });
    res.end();
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const route = `${req.method ?? "GET"} ${url.pathname}`;
    const handle = async (): Promise<void> => {
      switch (route) {
        case "GET /.well-known/openid-configuration":
          if (failing.has("discovery")) {
            sendJson(res, 500, { error: "server_error" });
            return;
          }
          sendJson(res, 200, {
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
          });
          return;
        case "GET /jwks":
          if (failing.has("jwks")) {
            sendJson(res, 500, { error: "server_error" });
            return;
          }
          sendJson(res, 200, { keys: [publicJwk] });
          return;
        case "GET /authorize":
          authorize(url, res);
          return;
        case "POST /token":
          await token(req, res);
          return;
        default:
          sendJson(res, 404, { error: "not_found" });
      }
    };
    handle().catch(() => {
      sendJson(res, 500, { error: "server_error" });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  issuer = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  return {
    issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    grant(code, claims, opts = {}) {
      grants.set(code, { claims, options: opts });
    },
    failEndpoint(endpoint, isFailing) {
      if (isFailing) failing.add(endpoint);
      else failing.delete(endpoint);
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}
