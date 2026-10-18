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
import { POST as discardPost } from "./discard/route";
import { POST as retryTypePost } from "./retry-type/route";
import { POST as retryPost } from "./retry/route";

const BASE = "https://forms.example.com";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CSRF = "csrf-token-1";
const OPERATIONS = "/admin/operations";
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

beforeEach(() => {
  identity = makeDeps({ publicBaseUrl: BASE });
  review = makeReviewDeps();
  review.jobs.add({ type: "media.upload" });
  review.jobs.add({ type: "media.upload" });
  review.jobs.add({ type: "email.staff_notification" });
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

type Handler = (request: Request) => Promise<Response>;

function post(
  handler: Handler,
  route: string,
  fields: Record<string, string>,
  cookie: string | null = `${COOKIE}=${SESSION_ID}`,
): Promise<Response> {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  if (cookie !== null) headers.set("cookie", cookie);
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return handler(new Request(`${BASE}${OPERATIONS}/${route}`, { method: "POST", headers, body }));
}

const status = (id: string) => review.jobs.jobs.find((job) => job.id === id)?.status;
const location = (res: Response) => res.headers.get("Location");

const ROUTES: [string, Handler, Record<string, string>][] = [
  ["retry", retryPost, { job: "dead-job-1" }],
  ["discard", discardPost, { job: "dead-job-1", reason: "Sent by hand" }],
  ["retry-type", retryTypePost, { type: "media.upload" }],
];

describe("Operations POST routes", () => {
  it.each(ROUTES)(
    "%s sends a post without a session to sign-in from Operations",
    async (route, handler, fields) => {
      const res = await post(handler, route, { csrf: CSRF, ...fields }, null);
      expect(res.status).toBe(302);
      expect(location(res)).toBe(signInPath(OPERATIONS));
      expect(status("dead-job-1")).toBe("dead");
    },
  );

  it.each(ROUTES)("%s refuses a stale token", async (route, handler, fields) => {
    const res = await post(handler, route, { csrf: "not-the-token", ...fields });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(identityCopy["auth.stale_title"].en);
    expect(status("dead-job-1")).toBe("dead");
  });

  it("operations/retry applies and returns with ?done=retried", async () => {
    const res = await post(retryPost, "retry", { csrf: CSRF, job: "dead-job-1" });
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${OPERATIONS}?done=retried`);
    expect(status("dead-job-1")).toBe("pending");
  });

  it("operations/retry returns to Operations without a flash for a job that is not dead", async () => {
    const res = await post(retryPost, "retry", { csrf: CSRF, job: "dead-job-9" });
    expect(location(res)).toBe(OPERATIONS);
  });

  it("operations/discard applies and returns with ?done=discarded", async () => {
    const res = await post(discardPost, "discard", {
      csrf: CSRF,
      job: "dead-job-1",
      reason: "  Sent by hand  ",
    });
    expect(location(res)).toBe(`${OPERATIONS}?done=discarded`);
    expect(review.jobs.jobs[0]).toMatchObject({
      status: "discarded",
      discardReason: "Sent by hand",
    });
  });

  it.each([
    ["blank", "   "],
    ["too long", "x".repeat(201)],
  ])(
    "operations/discard returns a refusal with ?error=reason_invalid&job=<id> for a %s reason",
    async (_name, reason) => {
      const res = await post(discardPost, "discard", { csrf: CSRF, job: "dead-job-1", reason });
      expect(location(res)).toBe(`${OPERATIONS}?error=reason_invalid&job=dead-job-1`);
      expect(status("dead-job-1")).toBe("dead");
    },
  );

  it("operations/retry-type applies and returns with ?done=retried_all&n=<count>", async () => {
    const res = await post(retryTypePost, "retry-type", { csrf: CSRF, type: "media.upload" });
    expect(location(res)).toBe(`${OPERATIONS}?done=retried_all&n=2`);
    expect([status("dead-job-1"), status("dead-job-2"), status("dead-job-3")]).toEqual([
      "pending",
      "pending",
      "dead",
    ]);
  });
});
