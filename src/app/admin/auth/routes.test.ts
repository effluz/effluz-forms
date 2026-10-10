import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: () => Promise.resolve(undefined) }));
vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig, type AppConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import { sessionCookieMaxAgeSeconds } from "@/modules/identity/application";
import { makeDeps, type FakeIdentityDeps } from "@/modules/identity/application/testing/fakes";
import type { Logger } from "@/shared/application/ports/logger";
import { GET as callback } from "./callback/route";
import { GET as signin } from "./signin/route";
import { POST as signout } from "./signout/route";

const BASE = "https://forms.example.com";

const baseConfig = loadConfig({
  NODE_ENV: "test",
  PUBLIC_BASE_URL: BASE,
  DATABASE_URL: "postgres://user:pw@localhost:5432/none",
  STAGING_DIR: "./data/staging",
  PRIVACY_CONTACT_EMAIL: "privacy@example.com",
  SESSION_COOKIE_NAME: "effluz_admin_session",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_ALLOWED_HOSTED_DOMAIN: "effluz.com",
});

const SESSION = "effluz_admin_session";
const warn = vi.fn();
const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), child: () => logger };
let deps: FakeIdentityDeps;

/** A real container around the identity fakes; the pool is never queried by these routes. */
function useContainer(config: AppConfig = baseConfig) {
  vi.mocked(getContainer).mockReturnValue(
    buildContainer(config, { pool: {} as unknown as Pool, logger, identity: deps }),
  );
}

beforeEach(() => {
  warn.mockReset();
  deps = makeDeps({ publicBaseUrl: BASE });
  useContainer();
});

function workspaceClaims() {
  return {
    ok: true as const,
    claims: {
      email: "staff.member@effluz.com",
      emailVerified: true,
      hostedDomain: "effluz.com",
      name: "Staff Member",
    },
  };
}

/** The `name=value` pair of the Set-Cookie header for `name`, with its attributes. */
function setCookie(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

/** Starts sign-in and returns the Cookie header a browser would send to the callback. */
async function start(returnTo: string): Promise<string> {
  const res = await signin(
    new Request(`${BASE}/admin/auth/signin?returnTo=${encodeURIComponent(returnTo)}`),
  );
  const pair = setCookie(res, "effluz_signin")?.split(";")[0];
  if (pair === undefined) throw new Error("no attempt cookie");
  return pair;
}

function callbackRequest(cookie: string | null, query = "code=c&state=state-1"): Request {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
  if (cookie !== null) headers.set("cookie", cookie);
  return new Request(`${BASE}/admin/auth/callback?${query}`, { headers });
}

describe("GET /admin/auth/signin", () => {
  it("stores the attempt in a short-lived cookie and redirects to the provider", async () => {
    const res = await signin(new Request(`${BASE}/admin/auth/signin?returnTo=%2Fadmin%2Fforms`));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(deps.identity.start.authorizationUrl);
    expect(setCookie(res, "effluz_signin")).toBe(
      "effluz_signin=id-1; Path=/admin/auth; HttpOnly; SameSite=Lax; Max-Age=600",
    );
    expect(deps.identity.beginCalls).toEqual([`${BASE}/admin/auth/callback`]);
  });

  it("marks the attempt cookie Secure when the config asks for it", async () => {
    useContainer({ ...baseConfig, session: { ...baseConfig.session, secure: true } });
    const res = await signin(new Request(`${BASE}/admin/auth/signin`));
    expect(setCookie(res, "effluz_signin")).toMatch(/; Secure$/);
  });

  it("goes to the error page when the provider cannot be reached, logging only the error class", async () => {
    deps.identity.beginSignIn = () => Promise.reject(new TypeError("fetch failed"));
    const res = await signin(new Request(`${BASE}/admin/auth/signin`));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/auth/error");
    expect(setCookie(res, "effluz_signin")).toBeUndefined();
    expect(warn).toHaveBeenCalledWith("sign-in failed", { step: "start", error: "TypeError" });
  });
});

describe("GET /admin/auth/callback", () => {
  it("sets the session cookie, clears the attempt cookie and returns to the requested path", async () => {
    const cookie = await start("/admin/forms");
    deps.identity.script(workspaceClaims());

    const res = await callback(callbackRequest(cookie));

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/forms");
    const [session] = deps.sessions.all();
    if (session === undefined) throw new Error("no session created");
    expect(setCookie(res, SESSION)).toBe(
      `${SESSION}=${session.id}; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=${String(sessionCookieMaxAgeSeconds())}`,
    );
    expect(setCookie(res, "effluz_signin")).toBe(
      "effluz_signin=; Path=/admin/auth; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    expect(deps.identity.completeCalls[0]?.input.url).toBe(
      `${BASE}/admin/auth/callback?code=c&state=state-1`,
    );
    expect(deps.audit.entries.at(-1)?.entry).toMatchObject({
      action: "sign_in",
      ip: "203.0.113.7",
    });
  });

  it("marks the session cookie Secure when the config asks for it", async () => {
    useContainer({ ...baseConfig, session: { ...baseConfig.session, secure: true } });
    const cookie = await start("/admin");
    deps.identity.script(workspaceClaims());
    const res = await callback(callbackRequest(cookie));
    expect(setCookie(res, SESSION)).toMatch(
      /^effluz_admin_session=[^;]+; Path=\/admin; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/,
    );
  });

  it("sends a refused account to the denied page without a session cookie", async () => {
    const cookie = await start("/admin");
    deps.identity.script({
      ok: true,
      claims: { email: "someone@gmail.com", emailVerified: true, name: "Someone" },
    });

    const res = await callback(callbackRequest(cookie));

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/auth/denied");
    expect(setCookie(res, SESSION)).toBeUndefined();
    expect(deps.sessions.all()).toEqual([]);
  });

  it("restarts sign-in once when the attempt is missing", async () => {
    const res = await callback(callbackRequest(null));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/auth/signin?returnTo=/admin&retried=1");
    expect(setCookie(res, SESSION)).toBeUndefined();
  });

  it("shows the error page instead of restarting a second time when the query says retried=1", async () => {
    const res = await callback(callbackRequest(null, "code=c&state=state-1&retried=1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/auth/error");
  });

  it("carries the restart through the provider round trip, so a second failure ends at the error page", async () => {
    const restart = await signin(
      new Request(`${BASE}/admin/auth/signin?returnTo=/admin&retried=1`),
    );
    const cookies = ["effluz_signin", "effluz_signin_retry"].map((name) => {
      const pair = setCookie(restart, name)?.split(";")[0];
      if (pair === undefined) throw new Error(`no ${name} cookie`);
      return pair;
    });
    deps.identity.script({ ok: false, reason: "state_mismatch" });

    // The provider returns to the fixed redirect URI, so `retried` is not in this query.
    const res = await callback(callbackRequest(cookies.join("; ")));

    expect(res.headers.get("Location")).toBe("/admin/auth/error");
    expect(setCookie(res, "effluz_signin_retry")).toMatch(/^effluz_signin_retry=; .*Max-Age=0/);
  });

  it("clears a leftover restart marker when a person starts a fresh sign-in", async () => {
    const res = await signin(new Request(`${BASE}/admin/auth/signin`));
    expect(setCookie(res, "effluz_signin_retry")).toMatch(/^effluz_signin_retry=; .*Max-Age=0/);
  });

  it("shows the error page when the code exchange fails", async () => {
    const cookie = await start("/admin");
    deps.identity.script({ ok: false, reason: "exchange_failed" });
    const res = await callback(callbackRequest(cookie));
    expect(res.headers.get("Location")).toBe("/admin/auth/error");
    expect(setCookie(res, SESSION)).toBeUndefined();
  });

  it("shows the error page when completion throws, logging only the error class", async () => {
    const cookie = await start("/admin");
    // Nothing scripted: the fake rejects, as an unreachable provider or database would.
    const res = await callback(callbackRequest(cookie));
    expect(res.headers.get("Location")).toBe("/admin/auth/error");
    expect(warn).toHaveBeenCalledWith("sign-in failed", { step: "callback", error: "Error" });
  });

  it("lands on /admin when sign-in was started with an off-site returnTo", async () => {
    const cookie = await start("https://evil.example/admin");
    deps.identity.script(workspaceClaims());
    const res = await callback(callbackRequest(cookie));
    expect(res.headers.get("Location")).toBe("/admin");
  });
});

describe("POST /admin/auth/signout", () => {
  async function signedIn(): Promise<{ id: string; csrf: string }> {
    const cookie = await start("/admin");
    deps.identity.script(workspaceClaims());
    await callback(callbackRequest(cookie));
    const [session] = deps.sessions.all();
    if (session === undefined) throw new Error("no session created");
    return { id: session.id, csrf: session.csrfToken };
  }

  function signoutRequest(sessionId: string | null, csrf: string): Request {
    const headers = new Headers();
    if (sessionId !== null) headers.set("cookie", `${SESSION}=${sessionId}`);
    const body = new FormData();
    body.set("csrf", csrf);
    return new Request(`${BASE}/admin/auth/signout`, { method: "POST", headers, body });
  }

  it("destroys the session, clears the cookie and goes to the signed-out page", async () => {
    const { id, csrf } = await signedIn();
    const res = await signout(signoutRequest(id, csrf));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/auth/signed-out");
    expect(setCookie(res, SESSION)).toBe(
      `${SESSION}=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    expect(deps.sessions.has(id)).toBe(false);
  });

  it("refuses a wrong CSRF token with 403 and keeps the session", async () => {
    const { id } = await signedIn();
    const res = await signout(signoutRequest(id, "not-the-token"));
    expect(res.status).toBe(403);
    expect(setCookie(res, SESSION)).toBeUndefined();
    expect(deps.sessions.has(id)).toBe(true);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toMatch(/<h1>Sign-out did not go through<span lang="es">/);
    expect(html).toContain('href="/admin"');
  });

  it("sets no cookie when the request carries no session cookie, so a cross-site post cannot sign anyone out", async () => {
    const res = await signout(signoutRequest(null, "anything"));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/auth/signed-out");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("goes to the error page when sign-out fails, logging only the error class", async () => {
    const { id, csrf } = await signedIn();
    deps.sessions.findById = () => Promise.reject(new TypeError("connect ECONNREFUSED"));
    const res = await signout(signoutRequest(id, csrf));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/auth/error");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(warn).toHaveBeenCalledWith("sign-out failed", { error: "TypeError" });
  });

  it("clears the session cookie with Secure when the config asks for it", async () => {
    useContainer({ ...baseConfig, session: { ...baseConfig.session, secure: true } });
    const { id, csrf } = await signedIn();
    const res = await signout(signoutRequest(id, csrf));
    expect(setCookie(res, SESSION)).toBe(
      `${SESSION}=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    );
  });

  it("goes to the signed-out page when the cookie names no session", async () => {
    const res = await signout(signoutRequest("gone", "anything"));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/auth/signed-out");
    expect(setCookie(res, SESSION)).toMatch(/Max-Age=0/);
  });

  it("treats a body that is not a form as a missing token", async () => {
    const { id } = await signedIn();
    const res = await signout(
      new Request(`${BASE}/admin/auth/signout`, {
        method: "POST",
        headers: { cookie: `${SESSION}=${id}`, "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(403);
    expect(deps.sessions.has(id)).toBe(true);
  });
});
