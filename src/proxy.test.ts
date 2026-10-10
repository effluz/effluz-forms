import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import { makeDeps, type FakeIdentityDeps } from "@/modules/identity/application/testing/fakes";
import type { Logger } from "@/shared/application/ports/logger";
import { config as proxyConfig, proxy } from "./proxy";

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
  deps = makeDeps({ publicBaseUrl: BASE });
  vi.mocked(getContainer).mockReturnValue(
    buildContainer(config, { pool: {} as unknown as Pool, logger, identity: deps }),
  );
});

function seedSession(lastSeenAt = deps.clock.now()) {
  deps.sessions.seed({
    id: "session-1",
    email: "staff.member@effluz.com",
    name: "Staff Member",
    csrfToken: "csrf-1",
    createdAt: lastSeenAt,
    lastSeenAt,
  });
}

function request(path: string, cookie?: string): NextRequest {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
  if (cookie !== undefined) headers.set("cookie", cookie);
  return new NextRequest(`${BASE}${path}`, { headers });
}

/** Proxy passes the request on with this internal header. */
const passesThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("admin proxy gate", () => {
  it("runs on /admin and everything below it", () => {
    expect(proxyConfig.matcher).toEqual(["/admin/:path*"]);
  });

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

  it("redirects when the cookie names no session", async () => {
    const res = await proxy(request("/admin", `${COOKIE}=gone`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BASE}/admin/auth/signin?returnTo=%2Fadmin`);
  });

  it("redirects and removes an expired session, auditing the client IP", async () => {
    seedSession(new Date(deps.clock.now().getTime() - 9 * 60 * 60 * 1000));
    const res = await proxy(request("/admin", `${COOKIE}=session-1`));
    expect(res.status).toBe(302);
    expect(deps.sessions.has("session-1")).toBe(false);
    expect(deps.audit.entries.at(-1)?.entry).toMatchObject({
      action: "session_expired",
      ip: "203.0.113.7",
    });
  });

  it("lets an active session through", async () => {
    seedSession();
    const res = await proxy(request("/admin/forms", `${COOKIE}=session-1`));
    expect(passesThrough(res)).toBe(true);
    expect(res.headers.get("location")).toBeNull();
  });

  it("leaves the auth routes alone, without reading the container", async () => {
    vi.mocked(getContainer).mockClear();
    for (const path of ["/admin/auth/signin?returnTo=%2Fadmin", "/admin/auth/denied"]) {
      const res = await proxy(request(path));
      expect(passesThrough(res)).toBe(true);
    }
    expect(getContainer).not.toHaveBeenCalled();
  });

  it("sends the request to the error page when the container cannot be built", async () => {
    vi.mocked(getContainer).mockImplementation(() => {
      throw new Error("Invalid configuration: DATABASE_URL");
    });
    const res = await proxy(request("/admin/forms"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BASE}/admin/auth/error`);
  });

  it("sends the request to the error page when the session lookup fails, logging only the class", async () => {
    deps.sessions.findById = () => Promise.reject(new TypeError("connect ECONNREFUSED"));
    const res = await proxy(request("/admin", `${COOKIE}=session-1`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BASE}/admin/auth/error`);
    expect(warn).toHaveBeenCalledWith("admin gate failed", { error: "TypeError" });
  });
});
