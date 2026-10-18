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
import type { MediaRecord } from "@/modules/media/application";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { MAX_STAFF_UPLOAD_FILES } from "@/modules/review/application";
import { makeReviewDeps, type FakeReviewDeps } from "@/modules/review/application/testing/fakes";
import { seedAnotherStory, seedStory } from "@/modules/review/application/testing/fixtures";
import { emptyStory } from "@/modules/review/application/ports/story-repository";
import { POST as checkPost } from "./check/route";
import { POST as choicePost } from "./choice/route";
import { POST as correctionPost } from "./correction/route";
import { POST as deletePost } from "./delete/route";
import { GET as mediaGet } from "./media/[mediaId]/route";
import { POST as photosPost } from "./photos/route";
import { POST as removePost } from "./photos/remove/route";
import { GET as zipGet } from "./photos.zip/route";
import { POST as planPost } from "./plan/route";
import { POST as retryPost } from "./retry/route";
import { POST as revertPost } from "./revert/route";
import { POST as statusPost } from "./status/route";

const BASE = "https://forms.example.com";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CSRF = "csrf-token-1";
const REF = "ST-0001";
/** The list query a story form posts in `back`, and how it comes back in a Location. */
const BACK = "?status=viewed&page=2";
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
let story: Awaited<ReturnType<typeof seedStory>>;

async function setUp(over: Parameters<typeof seedStory>[1] = {}): Promise<void> {
  identity = makeDeps({ publicBaseUrl: BASE });
  review = makeReviewDeps();
  story = await seedStory(review, over);
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
}

beforeEach(() => setUp());

type Context = { params: Promise<{ id: string; reference: string }> };
type Handler = (request: Request, context: Context) => Promise<Response>;
type Fields = Record<string, string | readonly File[]>;

const storyBase = () => `/admin/forms/${story.formId}/submissions/${REF}`;
/** The story page with the posted list query and the route's own keys. */
const storyAt = (own = "", hash = "") =>
  `${storyBase()}${BACK}${own === "" ? "" : `&${own}`}${hash === "" ? "" : `#${hash}`}`;

function post(
  handler: Handler,
  route: string,
  fields: Fields,
  cookie: string | null = `${COOKIE}=${SESSION_ID}`,
  reference = REF,
): Promise<Response> {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  if (cookie !== null) headers.set("cookie", cookie);
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === "string") body.set(name, value);
    else for (const file of value) body.append(name, file);
  }
  const request = new Request(
    `${BASE}/admin/forms/${story.formId}/submissions/${reference}/${route}`,
    {
      method: "POST",
      headers,
      body,
    },
  );
  return handler(request, { params: Promise.resolve({ id: story.formId, reference }) });
}

/** A post with the CSRF token and the list query. */
const send = (handler: Handler, route: string, fields: Fields, reference = REF) =>
  post(handler, route, { csrf: CSRF, back: BACK, ...fields }, undefined, reference);

function get<P extends Record<string, string>>(
  handler: (request: Request, context: { params: Promise<P> }) => Promise<Response>,
  path: string,
  params: P,
  cookie: string | null = `${COOKIE}=${SESSION_ID}`,
): Promise<Response> {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  if (cookie !== null) headers.set("cookie", cookie);
  const request = new Request(`${BASE}${path}`, { headers });
  return handler(request, { params: Promise.resolve(params) });
}

const location = (res: Response) => res.headers.get("Location");
const curation = () => review.submissions.submissions.curation.get(story.submissionId);
const storyRow = () => review.stories.rows.get(story.submissionId);
const auditActions = () => review.audit.entries.map((e) => e.entry.action);

/** A synthetic upload of the given bytes. */
const file = (bytes: Uint8Array, name = "photo.jpg") =>
  new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });

/** A stored video of the story with no staging copy left. */
function addStoredVideo(): string {
  const id = review.ids.newId();
  const at = new Date("2026-10-16T14:00:00Z");
  const record: MediaRecord = {
    id,
    submissionId: story.submissionId,
    formId: story.formId,
    fieldKey: "f_photos",
    position: 3,
    kind: "video",
    status: "stored",
    contentType: "video/mp4",
    size: 128,
    stagingRef: null,
    durableKey: "forms/story-form/ST-0001/03-photos.mp4",
    providerRef: null,
    createdAt: at,
    updatedAt: at,
  };
  review.media.media.rows.set(id, record);
  return id;
}

/** Every story POST route with a body its guards let through. */
const ROUTES: [string, Handler, Fields][] = [
  ["correction", correctionPost, { field: "f_name", text: "Ana Corregida" }],
  ["revert", revertPost, { field: "f_name" }],
  ["status", statusPost, { intent: "publish", post_url: "" }],
  ["photos", photosPost, { files: [file(fakeImage())], source: "whatsapp", confirmed: "1" }],
  ["photos/remove", removePost, { media: "00000000-0000-4000-8000-000000000000" }],
  ["choice", choicePost, { media: "00000000-0000-4000-8000-000000000000", chosen: "1" }],
  ["check", checkPost, { check: "text_checked", value: "1" }],
  ["plan", planPost, { date: "2026-10-20", return: "story" }],
  ["retry", retryPost, {}],
  ["delete", deletePost, { typed: REF }],
];

describe("story POST routes: guards", () => {
  it.each(ROUTES)(
    "%s sends a post without a session to sign-in from the story page",
    async (route, handler, fields) => {
      const res = await post(handler, route, { csrf: CSRF, back: BACK, ...fields }, null);
      expect(res.status).toBe(302);
      expect(location(res)).toBe(signInPath(storyBase()));
      expect(curation()).toBeUndefined();
    },
  );

  it.each(ROUTES)("%s refuses a stale token", async (route, handler, fields) => {
    const res = await post(handler, route, { csrf: "not-the-token", back: BACK, ...fields });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(identityCopy["auth.stale_title"].en);
    expect(curation()).toBeUndefined();
  });

  it.each<[string, Handler, Fields]>([
    ["status", statusPost, { intent: "archive" }],
    ["choice", choicePost, { media: "00000000-0000-4000-8000-000000000000", chosen: "yes" }],
    ["check", checkPost, { check: "photos_chosen", value: "1" }],
    ["check", checkPost, { check: "text_checked", value: "true" }],
  ])("%s answers a tampered body with 400", async (route, handler, fields) => {
    const res = await send(handler, route, fields);
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(curation()).toBeUndefined();
    expect(storyRow()).toBeUndefined();
  });

  it("returns a missing story to its story page, which renders the not-found body", async () => {
    const res = await send(
      correctionPost,
      "correction",
      { field: "f_name", text: "Hola" },
      "ST-0404",
    );
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`/admin/forms/${story.formId}/submissions/ST-0404${BACK}`);
  });
});

describe("POST .../correction", () => {
  it("correction applies and returns with done=saved", async () => {
    const res = await send(correctionPost, "correction", {
      field: "f_name",
      text: "Ana Corregida",
    });
    expect(res.status).toBe(303);
    expect(location(res)).toBe(storyAt("done=saved"));
    expect(curation()?.curatedAnswers).toEqual({ f_name: "Ana Corregida" });
  });

  it("correction returns a refusal with edit=<field>&error=<code>", async () => {
    const res = await send(correctionPost, "correction", { field: "f_name", text: "   " });
    expect(location(res)).toBe(storyAt("edit=f_name&error=correction_blank"));
    expect(curation()).toBeUndefined();
  });

  it("correction returns a refusal with n=<max> for too long", async () => {
    await setUp({ nameMaxLength: 5 });
    const res = await send(correctionPost, "correction", { field: "f_name", text: "Ana Larga" });
    expect(location(res)).toBe(storyAt("edit=f_name&error=correction_too_long&n=5"));
  });

  it("correction returns a refusal with the story page for a field that is not curatable", async () => {
    const res = await send(correctionPost, "correction", { field: "f_baby", text: "Sí" });
    expect(location(res)).toBe(storyAt());
  });
});

describe("POST .../revert", () => {
  it("revert applies and returns with done=reverted", async () => {
    await send(correctionPost, "correction", { field: "f_name", text: "Ana Corregida" });
    const res = await send(revertPost, "revert", { field: "f_name" });
    expect(location(res)).toBe(storyAt("done=reverted"));
    expect(curation()?.curatedAnswers).toEqual({});
  });

  it("revert returns a refusal with the story page", async () => {
    const res = await send(revertPost, "revert", { field: "f_name" });
    expect(location(res)).toBe(storyAt());
  });
});

describe("POST .../status", () => {
  it("status applies and returns with done=published", async () => {
    const res = await send(statusPost, "status", {
      intent: "publish",
      post_url: "https://www.instagram.com/p/example/",
    });
    expect(location(res)).toBe(storyAt("done=published"));
    expect(curation()).toMatchObject({
      status: "published",
      publishedPostUrl: "https://www.instagram.com/p/example/",
    });
  });

  it("status applies and returns with done=unpublished", async () => {
    await send(statusPost, "status", { intent: "publish", post_url: "" });
    const res = await send(statusPost, "status", { intent: "unpublish" });
    expect(location(res)).toBe(storyAt("done=unpublished"));
    expect(curation()?.status).toBe("viewed");
  });

  it("status applies and returns with done=unpublished_waiting&other=<ref>", async () => {
    const other = await seedAnotherStory(review, story.formId);
    review.stories.rows.set(story.submissionId, {
      ...emptyStory(story.submissionId, story.formId),
      plannedOn: "2026-10-20",
    });
    await send(statusPost, "status", { intent: "publish", post_url: "" });
    review.stories.rows.set(other.submissionId, {
      ...emptyStory(other.submissionId, story.formId),
      plannedOn: "2026-10-20",
    });

    const res = await send(statusPost, "status", { intent: "unpublish" });
    expect(location(res)).toBe(storyAt("done=unpublished_waiting&other=ST-0002"));
    expect(storyRow()?.plannedOn).toBeNull();
  });

  it("status returns a refusal with action=publish&error=post_url_invalid", async () => {
    const res = await send(statusPost, "status", { intent: "publish", post_url: "ftp://x" });
    expect(location(res)).toBe(storyAt("action=publish&error=post_url_invalid"));
    expect(curation()).toBeUndefined();
  });
});

describe("POST .../photos", () => {
  it("photos applies and returns with done=photos_added&n=<count>#photos", async () => {
    const res = await send(photosPost, "photos", {
      files: [file(fakeImage()), file(fakeImage("image/png"), "second.png")],
      source: "whatsapp",
      confirmed: "1",
    });
    expect(location(res)).toBe(storyAt("done=photos_added&n=2", "photos"));
    expect(review.staffPhotos.rows.size).toBe(2);
  });

  it("photos reads every file of the multipart body", async () => {
    const files = Array.from({ length: 3 }, (_, i) => file(fakeImage(), `p${String(i)}.jpg`));
    const res = await send(photosPost, "photos", { files, source: "email", confirmed: "1" });
    expect(location(res)).toBe(storyAt("done=photos_added&n=3", "photos"));
    expect([...review.staffPhotos.rows.values()].map((row) => row.source)).toEqual([
      "email",
      "email",
      "email",
    ]);
  });

  it.each([
    ["not_confirmed", { files: [file(fakeImage())], source: "whatsapp" }],
    ["source_invalid", { files: [file(fakeImage())], source: "fax", confirmed: "1" }],
    ["no_files", { files: [new File([], "")], source: "whatsapp", confirmed: "1" }],
  ])("photos returns a refusal with error=%s#photos", async (code, fields) => {
    const res = await send(photosPost, "photos", fields);
    expect(location(res)).toBe(storyAt(`error=${code}`, "photos"));
    expect(review.staffPhotos.rows.size).toBe(0);
  });

  it("photos returns a refusal with error=too_many_files&n=<max>#photos", async () => {
    const files = Array.from({ length: MAX_STAFF_UPLOAD_FILES + 1 }, () => file(fakeImage()));
    const res = await send(photosPost, "photos", { files, source: "whatsapp", confirmed: "1" });
    expect(location(res)).toBe(
      storyAt(`error=too_many_files&n=${String(MAX_STAFF_UPLOAD_FILES)}`, "photos"),
    );
  });

  it("photos returns a refusal with error=<reason>&n=<file>#photos for a refused file", async () => {
    const res = await send(photosPost, "photos", {
      files: [file(fakeImage()), file(fakeImage("application/pdf"), "doc.pdf")],
      source: "whatsapp",
      confirmed: "1",
    });
    expect(location(res)).toBe(storyAt("error=file_wrong_type&n=2", "photos"));
    expect(review.staffPhotos.rows.size).toBe(0);
  });

  it("photos returns a refusal with error=consent_missing#photos off the post plan", async () => {
    await setUp({ postPlan: false });
    const res = await send(photosPost, "photos", {
      files: [file(fakeImage())],
      source: "whatsapp",
      confirmed: "1",
    });
    expect(location(res)).toBe(storyAt("error=consent_missing", "photos"));
  });

  it("photos returns a refusal with error=consent_missing#photos without consent item 10", async () => {
    await setUp({ laterPhotos: false });
    const res = await send(photosPost, "photos", {
      files: [file(fakeImage())],
      source: "whatsapp",
      confirmed: "1",
    });
    expect(location(res)).toBe(storyAt("error=consent_missing", "photos"));
  });
});

describe("POST .../photos/remove", () => {
  it("photos/remove applies and returns with done=photo_removed#photos", async () => {
    await send(photosPost, "photos", {
      files: [file(fakeImage())],
      source: "whatsapp",
      confirmed: "1",
    });
    const [staff] = [...review.staffPhotos.rows.keys()];
    const res = await send(removePost, "photos/remove", { media: staff ?? "" });
    expect(location(res)).toBe(storyAt("done=photo_removed", "photos"));
    expect(review.staffPhotos.rows.size).toBe(0);
  });

  it("photos/remove returns a refusal with the story page for a sender's photo", async () => {
    const res = await send(removePost, "photos/remove", { media: story.photoIds[0] });
    expect(location(res)).toBe(storyAt());
  });
});

describe("POST .../choice", () => {
  it("choice applies and returns with done=choice_saved#photos", async () => {
    const res = await send(choicePost, "choice", { media: story.photoIds[1], chosen: "1" });
    expect(location(res)).toBe(storyAt("done=choice_saved", "photos"));
    expect(storyRow()?.chosen).toEqual([story.photoIds[1]]);
  });

  it("choice returns a refusal with the story page for an unknown photo", async () => {
    const res = await send(choicePost, "choice", {
      media: "00000000-0000-4000-8000-000000000000",
      chosen: "1",
    });
    expect(location(res)).toBe(storyAt());
  });
});

describe("POST .../check", () => {
  it("check applies and returns with done=check_saved#readiness", async () => {
    const res = await send(checkPost, "check", { check: "text_checked", value: "1" });
    expect(location(res)).toBe(storyAt("done=check_saved", "readiness"));
    expect(storyRow()?.textCheckedBy).toBe("staff.member@effluz.com");
  });

  it("check returns a refusal with error=no_photos_chosen#readiness", async () => {
    const res = await send(checkPost, "check", { check: "photos_edited", value: "1" });
    expect(location(res)).toBe(storyAt("error=no_photos_chosen", "readiness"));
  });
});

describe("POST .../plan", () => {
  it("plan applies and returns with done=planned#plan", async () => {
    const res = await send(planPost, "plan", { date: "2026-10-20", return: "story" });
    expect(location(res)).toBe(storyAt("done=planned", "plan"));
    expect(storyRow()?.plannedOn).toBe("2026-10-20");
  });

  it("plan applies and returns with done=plan_cleared#plan", async () => {
    await send(planPost, "plan", { date: "2026-10-20", return: "story" });
    const res = await send(planPost, "plan", { date: "", return: "story" });
    expect(location(res)).toBe(storyAt("done=plan_cleared", "plan"));
    expect(storyRow()?.plannedOn).toBeNull();
  });

  it("plan applies and returns with /admin/plan?week=<week> for return=plan", async () => {
    const res = await post(planPost, "plan", {
      csrf: CSRF,
      date: "2026-10-21",
      return: "plan",
      week: "2026-10-19",
    });
    expect(location(res)).toBe("/admin/plan?week=2026-10-19");
    expect(storyRow()?.plannedOn).toBe("2026-10-21");
  });

  it("plan returns a refusal with the conflict and conflict_swap=1 when it can swap", async () => {
    const other = await seedAnotherStory(review, story.formId);
    review.stories.rows.set(other.submissionId, {
      ...emptyStory(other.submissionId, story.formId),
      plannedOn: "2026-10-20",
    });
    review.stories.rows.set(story.submissionId, {
      ...emptyStory(story.submissionId, story.formId),
      plannedOn: "2026-10-22",
    });
    const res = await send(planPost, "plan", { date: "2026-10-20", return: "story" });
    expect(location(res)).toBe(
      storyAt("conflict_date=2026-10-20&conflict_ref=ST-0002&conflict_swap=1", "plan"),
    );
    expect(storyRow()?.plannedOn).toBe("2026-10-22");
  });

  it("plan returns a refusal with the conflict without conflict_swap when this story has no date", async () => {
    const other = await seedAnotherStory(review, story.formId);
    review.stories.rows.set(other.submissionId, {
      ...emptyStory(other.submissionId, story.formId),
      plannedOn: "2026-10-20",
    });
    const res = await send(planPost, "plan", { date: "2026-10-20", return: "story" });
    expect(location(res)).toBe(storyAt("conflict_date=2026-10-20&conflict_ref=ST-0002", "plan"));
  });

  it("plan returns a refusal with error=date_invalid#plan", async () => {
    const res = await send(planPost, "plan", { date: "2026-02-30", return: "story" });
    expect(location(res)).toBe(storyAt("error=date_invalid", "plan"));
  });

  it("plan returns a refusal with error=published#plan", async () => {
    await send(statusPost, "status", { intent: "publish", post_url: "" });
    const res = await send(planPost, "plan", { date: "2026-10-20", return: "story" });
    expect(location(res)).toBe(storyAt("error=published", "plan"));
  });

  it("plan returns a refusal with the story page off the post plan", async () => {
    await setUp({ postPlan: false });
    const res = await send(planPost, "plan", { date: "2026-10-20", return: "story" });
    expect(location(res)).toBe(storyAt());
  });
});

describe("POST .../retry", () => {
  it("retry applies and returns with done=retried", async () => {
    review.jobs.add({ type: "media.upload", payload: { mediaId: story.photoIds[0] } });
    const res = await send(retryPost, "retry", {});
    expect(location(res)).toBe(storyAt("done=retried"));
    expect(review.jobs.jobs[0]?.status).toBe("pending");
  });

  it("retry returns a refusal with the story page for a missing story", async () => {
    const res = await send(retryPost, "retry", {}, "ST-0404");
    expect(location(res)).toBe(`/admin/forms/${story.formId}/submissions/ST-0404${BACK}`);
  });
});

describe("POST .../delete", () => {
  it("delete applies and returns with the list and deleted=<ref>", async () => {
    const res = await send(deletePost, "delete", { typed: "st-0001 " });
    expect(location(res)).toBe(`/admin/forms/${story.formId}${BACK}&deleted=${REF}`);
    expect(review.submissions.submissions.rows.has(story.submissionId)).toBe(false);
  });

  it("delete applies and returns with the list and deleted=<ref> without a list query", async () => {
    const res = await post(deletePost, "delete", { csrf: CSRF, typed: REF });
    expect(location(res)).toBe(`/admin/forms/${story.formId}?deleted=${REF}`);
  });

  it("delete returns a refusal with action=delete&error=reference_mismatch", async () => {
    const res = await send(deletePost, "delete", { typed: "ST-0002" });
    expect(location(res)).toBe(storyAt("action=delete&error=reference_mismatch"));
    expect(review.submissions.submissions.rows.has(story.submissionId)).toBe(true);
  });
});

describe("GET .../media/[mediaId]", () => {
  const media = (mediaId: string, view: string, cookie?: string | null) =>
    get(
      mediaGet,
      `/admin/forms/${story.formId}/submissions/${REF}/media/${mediaId}?view=${view}`,
      { id: story.formId, reference: REF, mediaId },
      cookie,
    );

  it("media serves a thumbnail, a full photo, a download and a video redirect with the headers above", async () => {
    const [p1, p2] = story.photoIds;
    const thumb = await media(p1, "thumb");
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("Content-Type")).toBe("image/webp");
    expect(thumb.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(await thumb.text()).toBe("thumb:320");

    const full = await media(p2, "full");
    expect(full.status).toBe(200);
    expect(full.headers.get("Content-Type")).toBe("image/jpeg");
    expect(full.headers.get("Content-Length")).toBeNull();
    expect(full.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(full.headers.get("Cache-Control")).toBe("private, no-store");
    expect(full.headers.get("Content-Disposition")).toBe("inline");
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(fakeImage());

    const download = await media(p2, "download");
    expect(download.headers.get("Content-Disposition")).toBe(
      'attachment; filename="02-photos.jpg"',
    );
    expect(download.headers.get("Cache-Control")).toBe("private, no-store");

    const video = addStoredVideo();
    const redirect = await media(video, "full");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Location")).toBe(
      "memory://forms/story-form/ST-0001/03-photos.mp4",
    );
    expect(redirect.headers.get("Cache-Control")).toBe("no-store");
    expect(auditActions()).toEqual(
      expect.arrayContaining(["photo_viewed", "media_downloaded", "photo_viewed"]),
    );
  });

  it("media refuses an unknown view with 400 and a missing file with 404", async () => {
    expect((await media(story.photoIds[0], "raw")).status).toBe(400);
    const missing = await media("00000000-0000-4000-8000-000000000000", "full");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
  });

  it("media sends a request without a session to sign-in", async () => {
    const res = await media(story.photoIds[0], "full", null);
    expect(res.status).toBe(302);
    expect(location(res)).toBe(signInPath(`${storyBase()}/media/${story.photoIds[0]}`));
  });
});

describe("GET .../photos.zip", () => {
  const zip = (set: string) =>
    get(zipGet, `${storyBase()}/photos.zip?set=${set}`, { id: story.formId, reference: REF });

  it("photos.zip names the file and answers 404 when nothing is chosen", async () => {
    const all = await zip("all");
    expect(all.status).toBe(200);
    expect(all.headers.get("Content-Type")).toBe("application/zip");
    expect(all.headers.get("Content-Disposition")).toBe(
      'attachment; filename="story-form-ST-0001.zip"',
    );
    expect(all.headers.get("Cache-Control")).toBe("no-store");
    expect(await all.text()).toBe("ST-0001/01-photos.jpg\nST-0001/02-photos.jpg\n");

    const none = await zip("chosen");
    expect(none.status).toBe(404);
  });

  it("photos.zip answers 404 for the chosen set on a form without the post plan", async () => {
    await setUp({ postPlan: false });
    review.stories.rows.set(story.submissionId, {
      ...emptyStory(story.submissionId, story.formId),
      chosen: [story.photoIds[1]],
    });
    expect((await zip("chosen")).status).toBe(404);
  });

  it("photos.zip refuses an unknown set with 400 and a missing story with 404", async () => {
    expect((await zip("some")).status).toBe(400);
    const missing = await get(
      zipGet,
      `/admin/forms/${story.formId}/submissions/ST-0404/photos.zip?set=all`,
      {
        id: story.formId,
        reference: "ST-0404",
      },
    );
    expect(missing.status).toBe(404);
  });
});
