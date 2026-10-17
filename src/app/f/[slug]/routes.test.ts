import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import { seedPublished } from "@/modules/definitions/application/testing/fakes";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { postContext, savePage } from "@/modules/submissions/application";
import {
  makeSubmissionsDeps,
  post,
  publishStory,
  type FakeSubmissionsDeps,
} from "@/modules/submissions/application/testing/fakes";
import { POST as check } from "./check/route";
import { DELETE as remove } from "./files/[fileId]/route";
import { POST as upload } from "./files/route";
import { GET as restartGet, POST as restart } from "./restart/route";

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

/** The same app with the production configuration: Secure cookies, https only. */
const production = loadConfig({
  NODE_ENV: "production",
  PUBLIC_BASE_URL: "https://forms.example.com",
  DATABASE_URL: "postgres://user:pw@localhost:5432/none",
  STAGING_DIR: "./data/staging",
  PRIVACY_CONTACT_EMAIL: "privacy@example.com",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_ALLOWED_HOSTED_DOMAIN: "effluz.com",
  MEDIA_PROVIDER: "dropbox",
  DROPBOX_APP_KEY: "k",
  DROPBOX_APP_SECRET: "s",
  DROPBOX_REFRESH_TOKEN: "r",
  EMAIL_PROVIDER: "smtp2go",
  SMTP2GO_API_KEY: "api",
});

let deps: FakeSubmissionsDeps;

function useConfig(chosen: typeof config): void {
  vi.mocked(getContainer).mockReturnValue(
    buildContainer(chosen, {
      pool: {} as unknown as Pool,
      logger: deps.logger,
      submissions: deps,
      definitions: deps.definitions,
      media: deps.media,
    }),
  );
}

beforeEach(async () => {
  deps = makeSubmissionsDeps();
  await publishStory(deps);
  useConfig(config);
});

const params = <T extends Record<string, string>>(values: T) => ({
  params: Promise.resolve({ slug: "story-form", ...values }),
});

/** Saves page 1 so the record sits on the photos page; the cookie header that names it. */
async function onPhotos(): Promise<string> {
  const context = await postContext(deps, {
    slug: "story-form",
    state: { kind: "none" },
    submitToken: null,
  });
  if (!context.ok) throw new Error(context.outcome.kind);
  const out = await savePage(
    deps,
    context,
    post({
      renderedAt: new Date(deps.clock.now().getTime() - 20_000),
      answers: { f_name: "Ana Prueba", f_baby: "yes_opt" },
    }),
  );
  if (out.kind !== "show") throw new Error(out.kind);
  return `effluz_fill=${out.recordId}`;
}

function req(
  path: string,
  body: Record<string, string | File>,
  cookie?: string,
  extra: Record<string, string> = {},
): Request {
  const form = new FormData();
  for (const [name, value] of Object.entries(body)) form.append(name, value);
  const headers = new Headers(extra);
  if (cookie !== undefined) headers.set("cookie", cookie);
  return new Request(`https://forms.example.com/f/story-form${path}`, {
    method: "POST",
    headers,
    body: form,
  });
}

describe("the public routes", () => {
  it("uploads one file as JSON, refuses with a localized message, and removes", async () => {
    const cookie = await onPhotos();
    const ok = await upload(
      req(
        "/files",
        {
          field: "f_photos",
          _locale: "es",
          file: new File([new Uint8Array(fakeImage())], "a.jpg"),
        },
        cookie,
      ),
      params({}),
    );
    expect(ok.status).toBe(200);
    const staged = (await ok.json()) as { ok: true; file: { id: string }; label: string };
    expect(staged).toMatchObject({ ok: true, label: "Archivo 1, 1 kB" });
    expect(ok.headers.get("cache-control")).toBe("no-store");

    const refused = await upload(
      req(
        "/files",
        { field: "f_photos", _locale: "es", file: new File(["<html>"], "notes.jpg") },
        cookie,
      ),
      params({}),
    );
    expect(refused.status).toBe(422);
    // The browser sends every file as `upload`, so `{file}` is left for it to fill.
    expect(await refused.json()).toEqual({
      ok: false,
      message:
        "{file} no es un tipo permitido. Usa fotos JPEG, PNG, WebP o HEIC, o videos MP4 o MOV",
    });

    const gone = await remove(
      new Request(`https://forms.example.com/f/story-form/files/${staged.file.id}`, {
        method: "DELETE",
        headers: { cookie },
      }),
      params({ fileId: staged.file.id }),
    );
    expect(gone.status).toBe(204);
  });

  it("answers a storage failure with the retryable failed response, logging only the class", async () => {
    const cookie = await onPhotos();
    deps.media.staging.failPut = true;
    const res = await upload(
      req(
        "/files",
        {
          field: "f_photos",
          _locale: "es",
          file: new File([new Uint8Array(fakeImage())], "a.jpg"),
        },
        cookie,
      ),
      params({}),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, message: null });
    expect(deps.logger.lines.at(-1)).toMatchObject({
      level: "error",
      msg: "files route failed",
      fields: { slug: "story-form", error: "Error" },
    });
    expect(JSON.stringify(deps.logger.lines)).not.toContain("a.jpg");
  });

  it("checks one field with the server's rules", async () => {
    const bad = await check(
      req("/check", { _field: "f_email", _locale: "en", f_email: "nope" }),
      params({}),
    );
    expect(await bad.json()).toEqual({
      message: "Enter a valid email address, like name@example.com",
    });
    const good = await check(
      req("/check", { _field: "f_email", _locale: "en", f_email: "a@example.com" }),
      params({}),
    );
    expect(await good.json()).toEqual({ message: null });
    const unknown = await check(req("/check", { _field: "f_nope", _locale: "en" }), params({}));
    expect(unknown.status).toBe(400);
  });

  it("restarts by clearing the cookie on a same-origin POST", async () => {
    const res = await restart(
      new Request("https://forms.example.com/f/story-form/restart", {
        method: "POST",
        headers: { origin: "https://forms.example.com", "sec-fetch-site": "same-origin" },
      }),
      params({}),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/f/story-form");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("restarts a no-script POST that carries only an Origin", async () => {
    const res = await restart(
      new Request("https://forms.example.com/f/story-form/restart", {
        method: "POST",
        headers: { origin: "https://forms.example.com" },
      }),
      params({}),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("refuses a restart posted from another origin without clearing the cookie", async () => {
    for (const headers of [
      { origin: "https://evil.example.net" },
      { origin: "https://forms.example.com", "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
    ]) {
      const res = await restart(
        new Request("https://forms.example.com/f/story-form/restart", {
          method: "POST",
          headers,
        }),
        params({}),
      );
      expect(res.status).toBe(403);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("does not clear the cookie on a GET: a link, redirect or prefetch changes nothing", () => {
    const res = restartGet();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("sets Secure and the form's path on the renderer cookies in production", async () => {
    useConfig(production);
    const cookie = await onPhotos();
    const ok = await upload(
      req(
        "/files",
        {
          field: "f_photos",
          _locale: "es",
          file: new File([new Uint8Array(fakeImage())], "a.jpg"),
        },
        cookie,
      ),
      params({}),
    );
    expect(ok.status).toBe(200);
    const set = ok.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/^effluz_fill=/);
    expect(set).toContain("Secure");
    expect(set).toContain("Path=/f/story-form");

    const cleared = await restart(
      new Request("https://forms.example.com/f/story-form/restart", {
        method: "POST",
        headers: { origin: "https://forms.example.com" },
      }),
      params({}),
    );
    const clearing = cleared.headers.get("set-cookie") ?? "";
    expect(clearing).toContain("Secure");
    expect(clearing).toContain("Path=/f/story-form");
    expect(clearing).toContain("Max-Age=0");
  });
});

describe("the first early upload", () => {
  it("starts the record at the posted render time, so the minimum time counts from the render", async () => {
    // The story form with its photos page first and always shown: an upload can open the record.
    const story = await deps.versions.get(
      deps.definitions,
      [...deps.definitions.store.forms.values()][0]?.currentVersionId ?? "",
    );
    if (!story) throw new Error("no story version");
    const [contact, baby, consent] = story.document.pages;
    if (!contact || !baby || !consent) throw new Error("story pages");
    const photosPage = { ...baby };
    delete photosPage.visibility;
    await seedPublished(deps.definitions, {
      slug: "photos-first",
      document: { ...story.document, pages: [photosPage, contact, consent] },
    });
    const rendered = new Date(deps.clock.now().getTime() - 60_000);
    const res = await upload(
      new Request("https://forms.example.com/f/photos-first/files", {
        method: "POST",
        body: (() => {
          const body = new FormData();
          body.append("field", "f_photos");
          body.append("_locale", "es");
          body.append("_rendered", rendered.toISOString());
          body.append("file", new File([new Uint8Array(fakeImage())], "upload"));
          return body;
        })(),
      }),
      { params: Promise.resolve({ slug: "photos-first" }) },
    );
    expect(res.status).toBe(200);
    const [record] = [...deps.inProgress.rows.values()];
    expect(record?.startedAt.toISOString()).toBe(rendered.toISOString());
  });
});

/** Headers a request from another origin may carry; each alone is enough to refuse it. */
const FOREIGN: [string, Record<string, string>][] = [
  ["a same-site Origin", { origin: "https://www.effluz.com" }],
  ["an opaque Origin", { origin: "null" }],
  ["an Origin with another port", { origin: "https://forms.example.com:8443" }],
  ["Sec-Fetch-Site: same-site", { "sec-fetch-site": "same-site" }],
  ["Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }],
];

describe("requests from another origin", () => {
  it.each(FOREIGN)("refuses an early upload with %s and stages nothing", async (_n, headers) => {
    const cookie = await onPhotos();
    const before = JSON.stringify([...deps.inProgress.rows.values()]);
    const res = await upload(
      req(
        "/files",
        {
          field: "f_photos",
          _locale: "es",
          file: new File([new Uint8Array(fakeImage())], "a.jpg"),
        },
        cookie,
        headers,
      ),
      params({}),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(JSON.stringify([...deps.inProgress.rows.values()])).toBe(before);
  });

  it.each(FOREIGN)("refuses a file removal with %s and keeps the file", async (_n, headers) => {
    const cookie = await onPhotos();
    const ok = await upload(
      req(
        "/files",
        {
          field: "f_photos",
          _locale: "es",
          file: new File([new Uint8Array(fakeImage())], "a.jpg"),
        },
        cookie,
      ),
      params({}),
    );
    const staged = (await ok.json()) as { file: { id: string } };
    const res = await remove(
      new Request(`https://forms.example.com/f/story-form/files/${staged.file.id}`, {
        method: "DELETE",
        headers: { cookie, ...headers },
      }),
      params({ fileId: staged.file.id }),
    );
    expect(res.status).toBe(403);
    expect(JSON.stringify([...deps.inProgress.rows.values()])).toContain(staged.file.id);
  });

  it.each(FOREIGN)("refuses a field check with %s", async (_n, headers) => {
    const res = await check(
      req("/check", { _field: "f_email", _locale: "en", f_email: "nope" }, undefined, headers),
      params({}),
    );
    expect(res.status).toBe(403);
  });

  it("accepts the public origin and a same-origin fetch", async () => {
    const res = await check(
      req("/check", { _field: "f_email", _locale: "en", f_email: "nope" }, undefined, {
        origin: "https://forms.example.com",
        "sec-fetch-site": "same-origin",
      }),
      params({}),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: "Enter a valid email address, like name@example.com",
    });
  });
});
