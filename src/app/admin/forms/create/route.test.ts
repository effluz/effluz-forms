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
import { POST } from "./route";

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

const BLANK = {
  csrf: CSRF,
  kind: "blank",
  title_en: "Spring stories",
  title_es: "Historias de primavera",
  languages: "bilingual",
  slug: "",
};

/** The dialog's query after a refusal, as a plain object. */
function refusal(res: Response): Record<string, string> {
  const location = res.headers.get("Location") ?? "";
  expect(location.startsWith("/admin/forms/new?")).toBe(true);
  return Object.fromEntries(new URL(location, BASE).searchParams);
}

function create(fields: Record<string, string>, cookie: string | null = `${COOKIE}=${SESSION_ID}`) {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  if (cookie !== null) headers.set("cookie", cookie);
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return POST(new Request(`${BASE}/admin/forms/create`, { method: "POST", headers, body }));
}

describe("POST /admin/forms/create", () => {
  it("sends a request without a session to sign-in, returning to the dialog, and creates nothing", async () => {
    const res = await create(BLANK, null);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/auth/signin?returnTo=%2Fadmin%2Fforms%2Fnew");
    expect(definitions.store.forms.size).toBe(0);
  });

  it("refuses a wrong CSRF token with 403 and creates nothing", async () => {
    const res = await create({ ...BLANK, csrf: "not-the-token" });
    expect(res.status).toBe(403);
    expect(definitions.store.forms.size).toBe(0);
  });

  it("creates a blank form, deriving the slug, and goes to it", async () => {
    const res = await create(BLANK);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`/admin/forms/${fakeUuid(1)}`);
    const form = definitions.store.forms.get(fakeUuid(1));
    expect(form).toMatchObject({
      slug: "spring-stories",
      title: { en: "Spring stories", es: "Historias de primavera" },
      languages: "bilingual",
      status: "draft",
    });
    expect(definitions.audit.entries.at(-1)?.entry).toMatchObject({
      action: "form_created",
      actorEmail: "staff.member@effluz.com",
      ip: "203.0.113.7",
    });
  });

  it("uses the slug and the single language given", async () => {
    const res = await create({
      ...BLANK,
      title_es: "",
      languages: "en",
      slug: "  spring-2026  ",
    });
    expect(res.status).toBe(303);
    expect(definitions.store.forms.get(fakeUuid(1))).toMatchObject({
      slug: "spring-2026",
      title: { en: "Spring stories" },
      languages: "en",
    });
  });

  it("drops a title typed for a language the chosen mode does not use", async () => {
    await create({ ...BLANK, languages: "es" });
    expect(definitions.store.forms.get(fakeUuid(1))).toMatchObject({
      title: { es: "Historias de primavera" },
      languages: "es",
    });
    expect(definitions.store.forms.get(fakeUuid(1))?.title).not.toHaveProperty("en");
  });

  it("goes back to the dialog with slug_taken when the link name is in use", async () => {
    await seedForm(definitions, { slug: "spring-stories" });
    const res = await create({ ...BLANK, slug: "spring-stories" });
    expect(res.status).toBe(303);
    expect(refusal(res)).toEqual({
      error: "slug_taken",
      kind: "blank",
      title_en: "Spring stories",
      title_es: "Historias de primavera",
      languages: "bilingual",
      slug: "spring-stories",
    });
    expect(definitions.store.forms.size).toBe(1);
  });

  it("carries the source back for a refused duplicate", async () => {
    const source = await seedForm(definitions, { slug: "autumn-stories" });
    const res = await create({ ...BLANK, kind: "duplicate", source, slug: "autumn-stories" });
    expect(refusal(res)).toMatchObject({ error: "slug_taken", kind: "duplicate", source });
  });

  it("does not carry a title longer than the redirect can hold", async () => {
    const res = await create({ ...BLANK, title_en: "x".repeat(501), slug: "Not A Slug" });
    const query = refusal(res);
    expect(query).toMatchObject({ error: "slug_format", title_es: "Historias de primavera" });
    expect(query).not.toHaveProperty("title_en");
  });

  it("goes back to the dialog with title_missing when a required title is blank", async () => {
    const res = await create({ ...BLANK, title_es: "  " });
    expect(refusal(res)).toMatchObject({ error: "title_missing", title_en: "Spring stories" });
  });

  it("duplicates the chosen form", async () => {
    const source = await seedForm(definitions, { slug: "autumn-stories" });
    const res = await create({ ...BLANK, kind: "duplicate", source });
    expect(res.status).toBe(303);
    expect(definitions.audit.entries.at(-1)?.entry.details).toMatchObject({ duplicateOf: source });
  });

  it("ignores the source select when Blank is chosen", async () => {
    const source = await seedForm(definitions, { slug: "autumn-stories" });
    await create({ ...BLANK, source });
    expect(definitions.audit.entries.at(-1)?.entry.details).not.toHaveProperty("duplicateOf");
  });

  it("goes back with source_not_found when Duplicate has no form chosen", async () => {
    const res = await create({ ...BLANK, kind: "duplicate", source: "" });
    expect(refusal(res)).toMatchObject({ error: "source_not_found", kind: "duplicate" });
  });

  it("refuses a language mode the dialog does not offer with 400", async () => {
    const res = await create({ ...BLANK, languages: "fr" });
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(definitions.store.forms.size).toBe(0);
  });
});
