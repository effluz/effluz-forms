import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import {
  fakeUuid,
  makeDefinitionsDeps,
  seedForm,
  type FakeDefinitionsDeps,
} from "@/modules/definitions/application/testing/fakes";
import { makeDeps, type FakeIdentityDeps } from "@/modules/identity/application/testing/fakes";
import { POST as deletePost } from "./delete/route";
import { POST as lifecyclePost } from "./lifecycle/route";

const BASE = "https://forms.example.com";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CSRF = "csrf-token-1";
const VERSION_ID = "00000099-0000-4000-8000-000000000099";
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

let identity: FakeIdentityDeps;
let definitions: FakeDefinitionsDeps;

beforeEach(() => {
  identity = makeDeps({ publicBaseUrl: BASE });
  definitions = makeDefinitionsDeps();
  vi.mocked(getContainer).mockReturnValue(
    buildContainer(config, { pool: {} as unknown as Pool, identity, definitions }),
  );
  const now = identity.clock.now();
  identity.sessions.seed({
    id: SESSION_ID,
    email: "staff.member@effluz.com",
    name: "Staff Member",
    csrfToken: CSRF,
    createdAt: now,
    lastSeenAt: now,
  });
});

type Handler = typeof lifecyclePost;

function post(
  handler: Handler,
  id: string,
  path: "lifecycle" | "delete",
  fields: Record<string, string>,
  cookie: string | null = `${COOKIE}=${SESSION_ID}`,
) {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  if (cookie !== null) headers.set("cookie", cookie);
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const request = new Request(`${BASE}/admin/forms/${id}/${path}`, {
    method: "POST",
    headers,
    body,
  });
  return handler(request, { params: Promise.resolve({ id }) });
}

const lifecycle = (id: string, fields: Record<string, string>, cookie?: string | null) =>
  post(lifecyclePost, id, "lifecycle", fields, cookie);
const remove = (id: string, fields: Record<string, string>, cookie?: string | null) =>
  post(deletePost, id, "delete", fields, cookie);

function seedPublished() {
  return seedForm(definitions, {
    patch: { status: "published", currentVersionId: VERSION_ID, currentVersionNumber: 1 },
  });
}

describe("POST /admin/forms/[id]/lifecycle", () => {
  it("sends a request without a session to sign-in, returning to the overview", async () => {
    const id = await seedPublished();
    const res = await lifecycle(id, { csrf: CSRF, action: "close" }, null);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      `/admin/auth/signin?returnTo=${encodeURIComponent(`/admin/forms/${id}`)}`,
    );
    expect(definitions.store.forms.get(id)?.status).toBe("published");
  });

  it("refuses a wrong CSRF token with 403 and changes nothing", async () => {
    const id = await seedPublished();
    const res = await lifecycle(id, { csrf: "not-the-token", action: "close" });
    expect(res.status).toBe(403);
    expect(definitions.store.forms.get(id)?.status).toBe("published");
  });

  it("closes a published form and returns to its overview", async () => {
    const id = await seedPublished();
    const res = await lifecycle(id, { csrf: CSRF, action: "close" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`/admin/forms/${id}`);
    expect(definitions.store.forms.get(id)?.status).toBe("closed");
    expect(definitions.audit.entries.at(-1)?.entry).toMatchObject({
      action: "form_closed",
      actorEmail: "staff.member@effluz.com",
      targetId: id,
      ip: "203.0.113.7",
    });
  });

  it("returns with invalid_transition when the form does not allow the action", async () => {
    const id = await seedForm(definitions);
    const res = await lifecycle(id, { csrf: CSRF, action: "close" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`/admin/forms/${id}?error=invalid_transition`);
    expect(definitions.store.forms.get(id)?.status).toBe("draft");
  });

  it("refuses an action the overview does not offer with 400", async () => {
    const id = await seedPublished();
    const res = await lifecycle(id, { csrf: CSRF, action: "publish" });
    expect(res.status).toBe(400);
    expect(definitions.store.forms.get(id)?.status).toBe("published");
  });

  it("goes to the overview, which is not found, for an unknown form", async () => {
    const res = await lifecycle(fakeUuid(42), { csrf: CSRF, action: "close" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`/admin/forms/${fakeUuid(42)}`);
  });
});

describe("POST /admin/forms/[id]/delete", () => {
  it("sends a request without a session to sign-in and deletes nothing", async () => {
    const id = await seedForm(definitions);
    const res = await remove(id, { csrf: CSRF, slug: "sample-form" }, null);
    expect(res.status).toBe(302);
    expect(definitions.store.forms.has(id)).toBe(true);
  });

  it("refuses a wrong CSRF token with 403 and deletes nothing", async () => {
    const id = await seedForm(definitions);
    const res = await remove(id, { csrf: "not-the-token", slug: "sample-form" });
    expect(res.status).toBe(403);
    expect(definitions.store.forms.has(id)).toBe(true);
  });

  it("returns to the confirmation with slug_mismatch on a wrong slug", async () => {
    const id = await seedForm(definitions);
    const res = await remove(id, { csrf: CSRF, slug: "sample-form " });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(
      `/admin/forms/${id}?action=delete&error=slug_mismatch`,
    );
    expect(definitions.store.forms.has(id)).toBe(true);
  });

  it("returns with not_allowed for a form that was published", async () => {
    const id = await seedPublished();
    const res = await remove(id, { csrf: CSRF, slug: "sample-form" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`/admin/forms/${id}?error=not_allowed`);
    expect(definitions.store.forms.has(id)).toBe(true);
  });

  it("deletes a never-published form and goes to the list", async () => {
    const id = await seedForm(definitions);
    const res = await remove(id, { csrf: CSRF, slug: "sample-form" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin/forms");
    expect(definitions.store.forms.has(id)).toBe(false);
    expect(definitions.audit.entries.at(-1)?.entry).toMatchObject({
      action: "form_deleted",
      targetId: id,
    });
  });
});
