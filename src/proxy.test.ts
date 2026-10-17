import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fallbackWarn = vi.hoisted(() => vi.fn());
vi.mock("@/shared/infrastructure/logging/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/infrastructure/logging/logger")>()),
  createLogger: () => ({ warn: fallbackWarn }),
}));
vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import { sanitizeReturnTo } from "@/modules/identity/application";
import { makeDeps, type FakeIdentityDeps } from "@/modules/identity/application/testing/fakes";
import type { Logger } from "@/shared/application/ports/logger";
import { config as proxyConfig, proxy } from "./proxy";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const BASE = "https://forms.example.com";
const config = loadConfig({
  NODE_ENV: "test",
  PUBLIC_BASE_URL: BASE,
  DATABASE_URL: "postgres://user:pw@localhost:5432/none",
  STAGING_DIR: "./data/staging",
  PRIVACY_CONTACT_EMAIL: "privacy@example.com",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_ALLOWED_HOSTED_DOMAIN: "effluz.com",
});
const COOKIE = config.session.cookieName;
const warn = vi.fn();
const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), child: () => logger };

let deps: FakeIdentityDeps;

beforeEach(() => {
  warn.mockReset();
  fallbackWarn.mockReset();
  deps = makeDeps({ publicBaseUrl: BASE });
  vi.mocked(getContainer).mockReturnValue(
    buildContainer(config, { pool: {} as unknown as Pool, logger, identity: deps }),
  );
});

function seedSession(lastSeenAt = deps.clock.now()) {
  deps.sessions.seed({
    id: SESSION_ID,
    email: "staff.member@effluz.com",
    name: "Staff Member",
    csrfToken: "csrf-1",
    createdAt: lastSeenAt,
    lastSeenAt,
  });
}

/** The origin the app sees behind the reverse proxy, unlike the public one. */
const INTERNAL = "http://10.0.0.5:3000";

function request(path: string, cookie?: string, origin = BASE, method = "GET"): NextRequest {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
  if (cookie !== undefined) headers.set("cookie", cookie);
  return new NextRequest(`${origin}${path}`, { headers, method });
}

/** Proxy passes the request on with this internal header. */
const passesThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("admin proxy gate", () => {
  it("redirects a request without a session to sign-in with the encoded request path", async () => {
    const res = await proxy(request("/admin/forms/1?tab=share"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${BASE}/admin/auth/signin?returnTo=${encodeURIComponent("/admin/forms/1?tab=share")}`,
    );
  });

  it("drops Next's internal _rsc parameter from the return path", async () => {
    const res = await proxy(request("/admin/forms?_rsc=abc123"));
    expect(res.headers.get("location")).toBe(
      `${BASE}/admin/auth/signin?returnTo=${encodeURIComponent("/admin/forms")}`,
    );
  });

  it("keeps the rest of the query as sent, so a slash in a value survives sanitizing", async () => {
    for (const query of ["?tab=a/b&_rsc=1", "?_rsc=1&tab=a/b", "?tab=a/b"]) {
      const res = await proxy(request(`/admin/forms${query}`));
      const returnTo = new URL(res.headers.get("location") ?? "").searchParams.get("returnTo");
      expect(returnTo).toBe("/admin/forms?tab=a/b");
      expect(sanitizeReturnTo(returnTo)).toBe("/admin/forms?tab=a/b");
    }
  });

  it("gates paths that only look like the auth routes", async () => {
    const lookalike = await proxy(request("/admin/authx"));
    expect(lookalike.status).toBe(302);
    expect(lookalike.headers.get("location")).toBe(
      `${BASE}/admin/auth/signin?returnTo=${encodeURIComponent("/admin/authx")}`,
    );
    const dotted = await proxy(request("/admin/auth/../forms"));
    expect(dotted.status).toBe(302);
    expect(dotted.headers.get("location")).toBe(
      `${BASE}/admin/auth/signin?returnTo=${encodeURIComponent("/admin/forms")}`,
    );
  });

  it.each([
    ["/admin/forms/create", "/admin/forms/new"],
    ["/admin/forms/create?title=x", "/admin/forms/new"],
    [
      "/admin/forms/00000001-0000-4000-8000-000000000001/lifecycle",
      "/admin/forms/00000001-0000-4000-8000-000000000001",
    ],
    [
      "/admin/forms/00000001-0000-4000-8000-000000000001/delete?x=1",
      "/admin/forms/00000001-0000-4000-8000-000000000001",
    ],
    [
      "/admin/forms/00000001-0000-4000-8000-000000000001/settings?tab=x",
      "/admin/forms/00000001-0000-4000-8000-000000000001/settings",
    ],
  ])("returns a POST to %s to the GET page %s after sign-in", async (path, page) => {
    const res = await proxy(request(path, undefined, BASE, "POST"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${BASE}/admin/auth/signin?returnTo=${encodeURIComponent(page)}`,
    );
  });

  it("keeps the query for GET and HEAD requests to the same paths", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await proxy(request("/admin/forms/create?title=x", undefined, BASE, method));
      expect(res.headers.get("location")).toBe(
        `${BASE}/admin/auth/signin?returnTo=${encodeURIComponent("/admin/forms/create?title=x")}`,
      );
    }
  });

  it("redirects when the cookie names no session", async () => {
    const res = await proxy(request("/admin", `${COOKIE}=gone`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BASE}/admin/auth/signin?returnTo=%2Fadmin`);
  });

  it("redirects and removes an expired session, auditing the client IP", async () => {
    seedSession(new Date(deps.clock.now().getTime() - 9 * 60 * 60 * 1000));
    const res = await proxy(request("/admin", `${COOKIE}=${SESSION_ID}`));
    expect(res.status).toBe(302);
    expect(deps.sessions.has(SESSION_ID)).toBe(false);
    expect(deps.audit.entries.at(-1)?.entry).toMatchObject({
      action: "session_expired",
      ip: "203.0.113.7",
    });
  });

  it("lets an active session through", async () => {
    seedSession();
    const res = await proxy(request("/admin/forms", `${COOKIE}=${SESSION_ID}`));
    expect(passesThrough(res)).toBe(true);
    expect(res.headers.get("location")).toBeNull();
  });

  it("leaves the auth routes alone, without reading the container", async () => {
    vi.mocked(getContainer).mockClear();
    for (const path of [
      "/admin/auth",
      "/admin/auth/signin?returnTo=%2Fadmin",
      "/admin/auth/denied",
    ]) {
      const res = await proxy(request(path));
      expect(passesThrough(res)).toBe(true);
    }
    expect(getContainer).not.toHaveBeenCalled();
  });

  it("sends the request to the error page on the request's own origin when the container cannot be built", async () => {
    vi.mocked(getContainer).mockImplementation(() => {
      throw new Error("Invalid configuration: DATABASE_URL");
    });
    const res = await proxy(request("/admin/forms", undefined, INTERNAL));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${INTERNAL}/admin/auth/error`);
    expect(fallbackWarn).toHaveBeenCalledWith("admin gate failed", { error: "Error" });
  });

  it("sends the request to the error page when the session lookup fails, logging only the class", async () => {
    deps.sessions.findById = () => Promise.reject(new TypeError("connect ECONNREFUSED"));
    const res = await proxy(request("/admin", `${COOKIE}=${SESSION_ID}`, INTERNAL));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BASE}/admin/auth/error`);
    expect(warn).toHaveBeenCalledWith("admin gate failed", { error: "TypeError" });
  });
});

describe("the renderer's Content-Security-Policy", () => {
  beforeEach(() => {
    vi.mocked(getContainer).mockClear();
  });

  it("adds a per-request nonce policy to the page and to its form posts, and leaves the session gate alone", async () => {
    const res = await proxy(new NextRequest("https://forms.example.com/f/story-form"));
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    const again = await proxy(
      new NextRequest("https://forms.example.com/f/story-form", { method: "POST" }),
    );
    expect(again.headers.get("content-security-policy")).toMatch(/'nonce-/);
    expect(again.headers.get("content-security-policy")).not.toBe(csp);
    expect(vi.mocked(getContainer)).not.toHaveBeenCalled();
  });

  it("matches /f/<slug> as well as /admin", () => {
    expect(proxyConfig.matcher).toEqual(["/admin/:path*", "/f/:slug"]);
  });
});
