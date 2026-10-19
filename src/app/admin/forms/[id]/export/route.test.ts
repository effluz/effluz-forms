import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import { makeDeps, type FakeIdentityDeps } from "@/modules/identity/application/testing/fakes";
import { copy as identityCopy } from "@/modules/identity/presentation/copy";
import { signInPath } from "@/modules/identity/presentation/http";
import { makeReviewDeps, type FakeReviewDeps } from "@/modules/review/application/testing/fakes";
import { seedStory } from "@/modules/review/application/testing/fixtures";
import { exportLabels } from "@/modules/review/presentation/export-labels";
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
let review: FakeReviewDeps;
let formId: string;

beforeEach(async () => {
  identity = makeDeps({ publicBaseUrl: BASE });
  review = makeReviewDeps();
  ({ formId } = await seedStory(review));
  vi.mocked(getContainer).mockReturnValue(
    buildContainer(config, {
      pool: {} as unknown as Pool,
      identity,
      definitions: review.definitions,
      submissions: review.submissions,
      media: review.media,
      review,
    }),
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

/** The dialog's fields: its choices and the set list filters as hidden fields. */
const DIALOG = { versions: "filter", text: "original", status: "viewed", q: "Ana" };

function exportPost(
  fields: Record<string, string>,
  cookie: string | null = `${COOKIE}=${SESSION_ID}`,
): Promise<Response> {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  if (cookie !== null) headers.set("cookie", cookie);
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const request = new Request(`${BASE}/admin/forms/${formId}/export`, {
    method: "POST",
    headers,
    body,
  });
  return POST(request, { params: Promise.resolve({ id: formId }) });
}

const exported = () =>
  review.audit.entries.filter((e) => e.entry.action === "submissions_exported");

describe("POST /admin/forms/[id]/export", () => {
  it("export sends a post without a session to sign-in from the overview", async () => {
    const res = await exportPost({ csrf: CSRF, ...DIALOG }, null);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(signInPath(`/admin/forms/${formId}`));
    expect(exported()).toHaveLength(0);
  });

  it("export refuses a stale token", async () => {
    const res = await exportPost({ csrf: "not-the-token", ...DIALOG });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(identityCopy["auth.stale_title"].en);
    expect(exported()).toHaveLength(0);
  });

  it.each([
    ["versions", { ...DIALOG, versions: "some" }],
    ["text", { ...DIALOG, text: "translated" }],
  ])("export answers a tampered %s with 400", async (_name, fields) => {
    const res = await exportPost({ csrf: CSRF, ...fields });
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(exported()).toHaveLength(0);
  });

  it("export streams the CSV with the BOM and headers", async () => {
    const res = await exportPost({ csrf: CSRF, ...DIALOG, paths: "1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="story-form-20261018-1500.csv"',
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const header = new TextDecoder().decode(bytes.subarray(3)).split("\r\n")[0] ?? "";
    const labels = exportLabels("es");
    expect(header.startsWith(labels.reference)).toBe(true);
    expect(header).toContain(labels.files);
  });

  it("export applies the dialog's choices and the list filters", async () => {
    await exportPost({ csrf: CSRF, ...DIALOG, text: "both", page: "3" });
    expect(exported().map((e) => e.entry.details)).toEqual([
      { versions: "all", text: "both", paths: false, count: 0, search: true, status: "viewed" },
    ]);
    const count = review.queries.calls.find((call) => call.method === "count");
    expect(count?.args[0]).toMatchObject({
      formId,
      status: "viewed",
      search: { text: "Ana" },
    });
  });

  it("export returns a refusal with ?export=1&error=too_large#export plus the query", async () => {
    review.queries.countResult = 10_001;
    const res = await exportPost({ csrf: CSRF, ...DIALOG });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(
      `/admin/forms/${formId}?status=viewed&q=Ana&export=1&error=too_large#export`,
    );
    expect(exported()).toHaveLength(0);
  });
});
