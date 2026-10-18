import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import { makeDeps, type FakeIdentityDeps } from "@/modules/identity/application/testing/fakes";
import { signInPath } from "@/modules/identity/presentation/http";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { makeReviewDeps, type FakeReviewDeps } from "@/modules/review/application/testing/fakes";
import { seedStory } from "@/modules/review/application/testing/fixtures";
import { GET } from "./route";

const BASE = "https://forms.example.com";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const VIDEO_KEY = "forms/story-form/ST-0001/03-photos.mp4";
const ENV = {
  NODE_ENV: "test" as const,
  PUBLIC_BASE_URL: BASE,
  DATABASE_URL: "postgres://user:pw@localhost:5432/none",
  STAGING_DIR: "./data/staging",
  PRIVACY_CONTACT_EMAIL: "privacy@example.com",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_ALLOWED_HOSTED_DOMAIN: "effluz.com",
};
const localConfig = loadConfig(ENV);
const dropboxConfig = loadConfig({
  ...ENV,
  MEDIA_PROVIDER: "dropbox",
  DROPBOX_APP_KEY: "test-app-key",
  DROPBOX_APP_SECRET: "test-app-secret",
  DROPBOX_REFRESH_TOKEN: "test-refresh-token",
});
const COOKIE = localConfig.session.cookieName;

let identity: FakeIdentityDeps;
let review: FakeReviewDeps;
let submissionId: string;
let videoId: string;

function useConfig(config: typeof localConfig): void {
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
}

beforeEach(async () => {
  identity = makeDeps({ publicBaseUrl: BASE });
  review = makeReviewDeps();
  const story = await seedStory(review);
  submissionId = story.submissionId;
  videoId = review.ids.newId();
  const at = new Date("2026-10-16T14:00:00Z");
  review.media.media.rows.set(videoId, {
    id: videoId,
    submissionId,
    formId: story.formId,
    fieldKey: "f_photos",
    position: 3,
    kind: "video",
    status: "stored",
    contentType: "video/mp4",
    size: 128,
    stagingRef: null,
    durableKey: VIDEO_KEY,
    providerRef: null,
    createdAt: at,
    updatedAt: at,
  });
  await review.media.durable.put(fakeImage("video/mp4", 96), VIDEO_KEY, "video/mp4");
  useConfig(localConfig);
  const now = identity.clock.now();
  identity.sessions.seed({
    id: SESSION_ID,
    email: "staff.member@effluz.com",
    name: "Staff Member",
    csrfToken: "csrf-token-1",
    createdAt: now,
    lastSeenAt: now,
  });
});

/** `encoded` is the path segment as sent; by default the key encoded as the redirect does. */
function local(
  key: string,
  cookie: string | null = `${COOKIE}=${SESSION_ID}`,
  encoded = encodeURIComponent(key),
) {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  if (cookie !== null) headers.set("cookie", cookie);
  return GET(new Request(`${BASE}/admin/media/local/${encoded}`, { headers }), {
    params: Promise.resolve({ key: encoded }),
  });
}

const viewed = () => review.audit.entries.filter((e) => e.entry.action === "photo_viewed");

describe("GET /admin/media/local/[key]", () => {
  it("local media streams a stored video with its type and records the view", async () => {
    const res = await local(VIDEO_KEY);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Accept-Ranges")).toBe("none");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(fakeImage("video/mp4", 96));
    expect(viewed().map((e) => e.entry)).toEqual([
      {
        action: "photo_viewed",
        actorEmail: "staff.member@effluz.com",
        targetId: submissionId,
        ip: "203.0.113.7",
        details: { mediaId: videoId, kind: "video" },
      },
    ]);
  });

  it("local media sends a request without a session to sign-in", async () => {
    const res = await local(VIDEO_KEY, null);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      signInPath(`/admin/media/local/${encodeURIComponent(VIDEO_KEY)}`),
    );
  });

  it("local media answers 404 for a photo, a key no story owns and a header asset", async () => {
    await review.media.durable.put(fakeImage(), "assets/header.png", "image/png");
    for (const key of [
      "forms/story-form/ST-0001/02-photos.jpg",
      "forms/story-form/ST-0002/01-photos.mp4",
      "assets/header.png",
    ]) {
      const res = await local(key);
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
    const malformed = await local("", undefined, "%E0%A4%A");
    expect(malformed.status).toBe(404);
    expect(viewed()).toHaveLength(0);
  });

  it("local media answers 404 when the durable provider is Dropbox", async () => {
    useConfig(dropboxConfig);
    const res = await local(VIDEO_KEY);
    expect(res.status).toBe(404);
    expect(viewed()).toHaveLength(0);
  });
});
