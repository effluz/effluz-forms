import type { Pool } from "pg";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ cookies: new Map<string, string>() }));

vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = request.cookies.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
  headers: () => Promise.resolve(new Headers({ "x-forwarded-for": "203.0.113.7" })),
}));
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
import { makeDeps, type FakeIdentityDeps } from "@/modules/identity/application/testing/fakes";
import { makeReviewDeps, type FakeReviewDeps } from "@/modules/review/application/testing/fakes";
import { seedStory } from "@/modules/review/application/testing/fixtures";
import * as overviewPage from "./forms/[id]/page";
import * as storyPage from "./forms/[id]/submissions/[reference]/page";
import * as operationsPage from "./operations/page";
import * as planPage from "./plan/page";

const BASE = "https://forms.example.com";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
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

let identity: FakeIdentityDeps;
let review: FakeReviewDeps;
let story: Awaited<ReturnType<typeof seedStory>>;

beforeEach(async () => {
  identity = makeDeps({ publicBaseUrl: BASE });
  review = makeReviewDeps();
  story = await seedStory(review);
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
    csrfToken: "csrf-1",
    createdAt: now,
    lastSeenAt: now,
  });
  request.cookies.set(config.session.cookieName, SESSION_ID);
});

type Query = Record<string, string>;
const props = <P extends object>(params: P, query: Query = {}) => ({
  params: Promise.resolve(params),
  searchParams: Promise.resolve(query),
});
const html = async (page: Promise<ReactElement>) => renderToStaticMarkup(await page);
const actions = () => review.audit.entries.map((e) => e.entry.action);

describe("review pages", () => {
  it("every new page and the overview export instant = false", () => {
    for (const page of [overviewPage, storyPage, planPage, operationsPage])
      expect(page.instant).toBe(false);
  });

  it("the overview renders the Submissions list in its tab, which is linked", async () => {
    const out = await html(
      overviewPage.default(props({ id: story.formId }, { status: "viewed", deleted: "ST-0009" })),
    );
    expect(out).toMatch(
      new RegExp(`<a [^>]*href="/admin/forms/${story.formId}"[^>]*aria-current="page"`),
    );
    expect(out).not.toContain('aria-disabled="true"');
    expect(out).toContain("ST-0009");
    expect(actions()).toContain("submissions_listed");
    const listed = review.queries.calls.find((call) => call.method === "list");
    expect(listed?.args[0]).toMatchObject({ status: "viewed" });
  });

  it("the overview renders the not-found body in the shell for a missing form, never throwing", async () => {
    const out = await html(
      overviewPage.default(props({ id: "00000000-0000-4000-8000-00000000dead" })),
    );
    expect(out).toContain("<h1");
    expect(out).toContain("Form not found");
    expect(out).toContain('href="/admin/forms"');
    expect(actions()).not.toContain("submissions_listed");
  });

  it("the overview opens the export dialog from ?export=1", async () => {
    const out = await html(overviewPage.default(props({ id: story.formId }, { export: "1" })));
    expect(out).toContain(`action="/admin/forms/${story.formId}/export"`);
  });

  it("the story page renders the story and records the view", async () => {
    const out = await html(
      storyPage.default(props({ id: story.formId, reference: story.reference })),
    );
    expect(out).toMatch(/<h1[^>]*>[^]*ST-0001/);
    expect(actions()).toContain("submission_viewed");
  });

  it("the story page renders the not-found body for a missing story, never throwing", async () => {
    const out = await html(
      storyPage.default(props({ id: story.formId, reference: "ST-0404" }, { status: "viewed" })),
    );
    expect(out).toContain("Submission not found");
    expect(out).toContain(`href="/admin/forms/${story.formId}?status=viewed"`);
    expect(actions()).not.toContain("submission_viewed");
  });

  it("the story page is titled with its reference", async () => {
    const metadata = await storyPage.generateMetadata({
      params: Promise.resolve({ id: story.formId, reference: story.reference }),
    });
    expect(metadata.title).toBe("ST-0001");
  });

  it("the post plan records one post_plan_viewed per load, with a picked day", async () => {
    const out = await html(planPage.default(props({}, { week: "2026-10-21", pick: "2026-10-22" })));
    expect(out).toContain("Post plan");
    expect(actions().filter((a) => a === "post_plan_viewed")).toHaveLength(1);
    const week = review.queries.calls.find((call) => call.method === "week");
    expect(week?.args.slice(1)).toEqual(["2026-10-19", "2026-10-25"]);
  });

  it("the operations page shows the flash and the refusal from its query", async () => {
    review.jobs.add({ type: "media.upload" });
    const done = await html(operationsPage.default(props({}, { done: "retried_all", n: "2" })));
    expect(done).toContain('role="status"');
    const refused = await html(
      operationsPage.default(props({}, { error: "reason_invalid", job: "dead-job-1" })),
    );
    expect(refused).toContain('aria-invalid="true"');
  });
});
