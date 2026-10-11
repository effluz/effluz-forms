import type { Pool } from "pg";
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
import { pageSession } from "./page";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const config = loadConfig({
  NODE_ENV: "test",
  PUBLIC_BASE_URL: "https://forms.example.com",
  DATABASE_URL: "postgres://user:pw@localhost:5432/none",
  STAGING_DIR: "./data/staging",
  PRIVACY_CONTACT_EMAIL: "privacy@example.com",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_ALLOWED_HOSTED_DOMAIN: "effluz.com",
});

let deps: FakeIdentityDeps;

beforeEach(() => {
  request.cookies.clear();
  request.headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  deps = makeDeps();
  vi.mocked(getContainer).mockReturnValue(
    buildContainer(config, { pool: {} as unknown as Pool, identity: deps }),
  );
});

describe("pageSession", () => {
  it("redirects to sign-in, returning to the page, without a session", async () => {
    await expect(pageSession("/admin/forms/new")).rejects.toThrow(
      "REDIRECT /admin/auth/signin?returnTo=%2Fadmin%2Fforms%2Fnew",
    );
  });

  it("returns the session, the container and the actor", async () => {
    const now = deps.clock.now();
    deps.sessions.seed({
      id: SESSION_ID,
      email: "staff.member@effluz.com",
      name: "Staff Member",
      csrfToken: "csrf-token-1",
      createdAt: now,
      lastSeenAt: now,
    });
    request.cookies.set(config.session.cookieName, SESSION_ID);
    const result = await pageSession("/admin/forms");
    expect(result.session.id).toBe(SESSION_ID);
    expect(result.container.identity).toBe(deps);
    expect(result.actor).toEqual({ email: "staff.member@effluz.com", ip: "203.0.113.7" });
  });
});
