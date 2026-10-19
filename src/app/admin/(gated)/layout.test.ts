import type { Pool } from "pg";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  headers: new Headers(),
}));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = request.cookies.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
  headers: () => Promise.resolve(request.headers),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import { makeDeps, type FakeIdentityDeps } from "@/modules/identity/application/testing/fakes";
import GatedLayout from "./layout";

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

let deps: FakeIdentityDeps;

beforeEach(() => {
  request.cookies.clear();
  request.headers = new Headers();
  deps = makeDeps({ publicBaseUrl: BASE });
  vi.mocked(getContainer).mockReturnValue(
    buildContainer(config, { pool: {} as unknown as Pool, identity: deps }),
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

async function render(): Promise<string> {
  const element = (await GatedLayout({ children: "page content" })) as ReactElement;
  return renderToStaticMarkup(element);
}

describe("admin session gate", () => {
  it("redirects to sign-in, returning to /admin, without a session cookie", async () => {
    await expect(render()).rejects.toThrow("REDIRECT /admin/auth/signin?returnTo=%2Fadmin");
  });

  it("returns to /admin, since the proxy has already redirected with the real path", async () => {
    request.headers = new Headers({ referer: `${BASE}/admin/forms/1` });
    await expect(render()).rejects.toThrow(/^REDIRECT \/admin\/auth\/signin\?returnTo=%2Fadmin$/);
  });

  it("redirects when the cookie names no session", async () => {
    request.cookies.set(COOKIE, "gone");
    await expect(render()).rejects.toThrow("REDIRECT /admin/auth/signin?returnTo=%2Fadmin");
  });

  it("redirects and removes an expired session", async () => {
    seedSession(new Date(deps.clock.now().getTime() - 9 * 60 * 60 * 1000));
    request.cookies.set(COOKIE, SESSION_ID);
    await expect(render()).rejects.toThrow("REDIRECT /admin/auth/signin");
    expect(deps.sessions.has(SESSION_ID)).toBe(false);
  });

  it("renders the shell with the signed-in name, the CSRF token and the page", async () => {
    seedSession();
    request.cookies.set(COOKIE, SESSION_ID);
    const html = await render();
    expect(html).toContain("Signed in as Staff Member");
    expect(html).toContain('name="csrf" value="csrf-1"');
    expect(html).toContain("page content");
  });

  it("renders the manager shell with Forms as the current section", async () => {
    seedSession();
    request.cookies.set(COOKIE, SESSION_ID);
    const html = await render();
    expect(html).toMatch(/<a [^>]*href="\/admin\/forms"[^>]*aria-current="page"[^>]*>Forms/);
    expect(html).toMatch(/<main [^>]*>page content<\/main>/);
  });

  it("marks the section from the proxy's header", async () => {
    seedSession();
    request.cookies.set(COOKIE, SESSION_ID);
    const current = (html: string) =>
      [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)</g)].map((m) => m[1]);

    request.headers = new Headers({ "x-effluz-section": "plan" });
    expect(current(await render())).toEqual(["Post plan", "Post plan"]);
    request.headers = new Headers({ "x-effluz-section": "operations" });
    expect(current(await render())).toEqual(["Operations", "Operations"]);
    request.headers = new Headers();
    expect(current(await render())).toEqual(["Forms", "Forms"]);
    request.headers = new Headers({ "x-effluz-section": "settings" });
    expect(current(await render())).toEqual(["Forms", "Forms"]);
  });
});
