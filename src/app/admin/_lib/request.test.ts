import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import { makeDeps, type FakeIdentityDeps } from "@/modules/identity/application/testing/fakes";
import { actorOf, localized, plain, requireCsrf, requireSession, seeOther, text } from "./request";

const BASE = "https://forms.example.com";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CSRF = "csrf-token-1";
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

let deps: FakeIdentityDeps;

beforeEach(() => {
  deps = makeDeps({ publicBaseUrl: BASE });
  vi.mocked(getContainer).mockReturnValue(
    buildContainer(config, { pool: {} as unknown as Pool, identity: deps }),
  );
});

function seedSession(): void {
  const now = deps.clock.now();
  deps.sessions.seed({
    id: SESSION_ID,
    email: "staff.member@effluz.com",
    name: "Staff Member",
    csrfToken: CSRF,
    createdAt: now,
    lastSeenAt: now,
  });
}

function post(body: FormData | string, cookie: string | null = `${COOKIE}=${SESSION_ID}`) {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
  if (cookie !== null) headers.set("cookie", cookie);
  if (typeof body === "string") headers.set("content-type", "application/json");
  return new Request(`${BASE}/admin/forms`, { method: "POST", headers, body });
}

function formWith(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) form.set(name, value);
  return form;
}

describe("text", () => {
  it("returns the string value of a field", () => {
    expect(text(formWith({ slug: "spring-stories" }), "slug")).toBe("spring-stories");
  });

  it("returns an empty string for a missing field or a file", () => {
    const form = new FormData();
    form.set("upload", new Blob(["x"]), "x.txt");
    expect(text(form, "slug")).toBe("");
    expect(text(form, "upload")).toBe("");
  });
});

describe("localized", () => {
  it("reads both languages from the _en and _es fields, trimmed", () => {
    const form = formWith({ title_en: "  Spring stories ", title_es: "Historias de primavera  " });
    expect(localized(form, "title")).toEqual({
      en: "Spring stories",
      es: "Historias de primavera",
    });
  });

  it("drops blank and missing languages", () => {
    expect(localized(formWith({ title_en: "Spring stories", title_es: "   " }), "title")).toEqual({
      en: "Spring stories",
    });
    expect(localized(new FormData(), "title")).toEqual({});
  });
});

describe("actorOf", () => {
  it("takes the email from the session and the first forwarded address", () => {
    seedSession();
    const [session] = deps.sessions.all();
    if (session === undefined) throw new Error("no session");
    expect(actorOf(session, post(new FormData()))).toEqual({
      email: "staff.member@effluz.com",
      ip: "203.0.113.7",
    });
  });
});

describe("seeOther", () => {
  it("is an uncached 303 to the location", () => {
    const res = seeOther("/admin/forms/abc");
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin/forms/abc");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("plain", () => {
  it("is an uncached response with the status and no body by default", async () => {
    const res = plain(404);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });

  it("carries a text body when given one", async () => {
    const res = plain(400, "Bad request");
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("Bad request");
  });
});

describe("requireSession", () => {
  it("redirects to sign-in, returning to the request path, without a session", async () => {
    const res = await requireSession(post(new FormData(), null));
    if (!(res instanceof Response)) throw new Error("expected a redirect");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/auth/signin?returnTo=%2Fadmin%2Fforms");
  });

  it("returns to the page given instead of the request path", async () => {
    const res = await requireSession(post(new FormData(), null), "/admin/forms/new");
    if (!(res instanceof Response)) throw new Error("expected a redirect");
    expect(res.headers.get("Location")).toBe("/admin/auth/signin?returnTo=%2Fadmin%2Fforms%2Fnew");
  });

  it("redirects to sign-in when the session has expired", async () => {
    seedSession();
    deps.clock.advance(9 * 60 * 60 * 1000);
    const res = await requireSession(post(new FormData()));
    expect(res instanceof Response && res.status).toBe(302);
  });

  it("resolves the active session and the container", async () => {
    seedSession();
    const res = await requireSession(post(new FormData()));
    if (res instanceof Response) throw new Error(`unexpected ${String(res.status)}`);
    expect(res.session.id).toBe(SESSION_ID);
    expect(res.container.identity).toBe(deps);
  });
});

describe("requireCsrf", () => {
  it("passes the session and the parsed form when the token matches", async () => {
    seedSession();
    const res = await requireCsrf(post(formWith({ csrf: CSRF, slug: "spring-stories" })));
    if (res instanceof Response) throw new Error(`unexpected ${String(res.status)}`);
    expect(res.session.id).toBe(SESSION_ID);
    expect(text(res.form, "slug")).toBe("spring-stories");
  });

  it("refuses a wrong or missing token with the out-of-date page", async () => {
    seedSession();
    for (const body of [formWith({ csrf: "not-the-token" }), new FormData()]) {
      const res = await requireCsrf(post(body));
      if (!(res instanceof Response)) throw new Error("expected a refusal");
      expect(res.status).toBe(403);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await res.text()).toContain("This page was out of date");
    }
  });

  it("refuses a body that is not a form", async () => {
    seedSession();
    const res = await requireCsrf(post(JSON.stringify({ csrf: CSRF })));
    expect(res instanceof Response && res.status).toBe(403);
  });

  it("checks the session before the token, returning to the page given", async () => {
    const res = await requireCsrf(post(formWith({ csrf: CSRF }), null), "/admin/forms/new");
    if (!(res instanceof Response)) throw new Error("expected a redirect");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/auth/signin?returnTo=%2Fadmin%2Fforms%2Fnew");
  });
});
