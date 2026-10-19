import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface CookieWrite {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

const request = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  headers: new Headers(),
  writes: [] as CookieWrite[],
}));

vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = request.cookies.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string, options: Record<string, unknown> = {}) => {
        request.writes.push({ name, value, options });
      },
    }),
  headers: () => Promise.resolve(request.headers),
}));
// Next's redirect() and notFound() throw to end the action; the sentinels stand in.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import {
  makeDefinitionsDeps,
  seedForm,
  type FakeDefinitionsDeps,
} from "@/modules/definitions/application/testing/fakes";
import {
  decodeSettingsState,
  SETTINGS_STATE_COOKIE,
  type SettingsFormState,
} from "@/modules/definitions/presentation/settings-form";
import { makeDeps, type FakeIdentityDeps } from "@/modules/identity/application/testing/fakes";
import { saveSettings } from "./actions";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CSRF = "csrf-token-1";
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

let identity: FakeIdentityDeps;
let definitions: FakeDefinitionsDeps;
let formId: string;

beforeEach(async () => {
  request.cookies.clear();
  request.cookies.set(config.session.cookieName, SESSION_ID);
  request.headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  request.writes = [];
  identity = makeDeps();
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
  formId = await seedForm(definitions, { slug: "spring-stories" });
});

const FIELDS = {
  csrf: CSRF,
  notificationRecipients: "team@effluz.com",
  notificationCadence: "daily",
  digestHour: "8",
  timezone: "America/Panama",
  retentionMonths: "12",
  referencePrefix: "SS",
  opensAt: "2026-11-01T09:00",
  closesAt: "",
  slug: "spring-stories",
};

const tab = () => `/admin/forms/${formId}/settings`;
const at = () => String(definitions.clock.now().getTime());

function save(fields: Record<string, string>, id = formId) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return saveSettings(id, data);
}

/** Saves, expects the redirect back to the tab with `refused`, and returns the state it left. */
async function refused(fields: Record<string, string>): Promise<SettingsFormState | null> {
  await expect(save(fields)).rejects.toThrow(`REDIRECT ${tab()}?refused=${at()}`);
  const write = request.writes.at(-1);
  expect(write).toMatchObject({
    name: SETTINGS_STATE_COOKIE,
    options: { httpOnly: true, sameSite: "lax", path: tab(), maxAge: 600, secure: false },
  });
  return decodeSettingsState(write?.value, at());
}

const auditActions = () => definitions.audit.entries.map((e) => e.entry.action);

describe("saveSettings", () => {
  it("sends a request without a session to sign-in, returning to the tab, and saves nothing", async () => {
    request.cookies.clear();
    await expect(save(FIELDS)).rejects.toThrow(
      `REDIRECT /admin/auth/signin?returnTo=${encodeURIComponent(tab())}`,
    );
    expect(auditActions()).not.toContain("form_settings_changed");
  });

  it("refuses a wrong CSRF token with the out-of-date state and saves nothing", async () => {
    const state = await refused({ ...FIELDS, csrf: "not-the-token" });
    expect(state?.error).toBe("stale");
    expect(state?.values?.digestHour).toBe("8");
    expect(definitions.store.forms.get(formId)?.settings.notificationCadence).toBe(
      "per_submission",
    );
    expect(auditActions()).not.toContain("form_settings_changed");
  });

  it("saves, audits, clears any earlier state and returns to the tab with the saved banner", async () => {
    await expect(save(FIELDS)).rejects.toThrow(`REDIRECT ${tab()}?saved=${at()}`);
    expect(definitions.store.forms.get(formId)?.settings).toMatchObject({
      notificationRecipients: ["team@effluz.com"],
      notificationCadence: "daily",
      digestHour: 8,
      opensAt: "2026-11-01T14:00:00.000Z",
    });
    expect(definitions.audit.entries.at(-1)?.entry).toMatchObject({
      action: "form_settings_changed",
      actorEmail: "staff.member@effluz.com",
      ip: "203.0.113.7",
      targetId: formId,
    });
    expect(request.writes).toHaveLength(1);
    expect(request.writes[0]).toMatchObject({
      name: SETTINGS_STATE_COOKIE,
      value: "",
      options: { maxAge: 0, path: tab() },
    });
  });

  it("returns the issues and the submitted values when the settings are invalid", async () => {
    const state = await refused({
      ...FIELDS,
      notificationRecipients: "team@effluz.com\nsomeone@example.com",
    });
    expect(state?.issues).toEqual([
      { code: "recipient_domain", path: "notificationRecipients.1", params: { index: 1 } },
    ]);
    expect(state?.values?.recipients).toBe("team@effluz.com\nsomeone@example.com");
    expect(auditActions()).not.toContain("form_settings_changed");
  });

  it("asks to confirm a shorter retention with the count, then saves once confirmed", async () => {
    const now = definitions.clock.now();
    const old = new Date(now.getTime());
    old.setUTCMonth(old.getUTCMonth() - 8);
    definitions.stats.receive(formId, old, old, now);

    const state = await refused({ ...FIELDS, retentionMonths: "6" });
    expect(state?.retentionConfirm).toEqual({ count: 2, months: 6 });
    expect(definitions.store.forms.get(formId)?.settings.retentionMonths).toBe(12);

    await expect(
      save({ ...FIELDS, retentionMonths: "6", confirmRetentionPurge: "1" }),
    ).rejects.toThrow(`REDIRECT ${tab()}?saved=`);
    expect(definitions.store.forms.get(formId)?.settings.retentionMonths).toBe(6);
    expect(definitions.audit.entries.at(-1)?.entry).toMatchObject({
      action: "retention_shortened",
      details: { from: 12, to: 6, count: 2 },
    });
  });

  it("returns a refused slug as the error", async () => {
    await seedForm(definitions, { slug: "autumn-stories" });
    const state = await refused({ ...FIELDS, slug: "autumn-stories" });
    expect(state?.error).toBe("slug_taken");
    expect(state?.values?.slug).toBe("autumn-stories");
  });

  it("answers not found for a form that does not exist", async () => {
    await expect(save(FIELDS, "00000009-0000-4000-8000-000000000009")).rejects.toThrow("NOT_FOUND");
  });
});
