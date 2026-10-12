import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
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
import { GET as restart } from "./restart/route";

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

let deps: FakeSubmissionsDeps;

beforeEach(async () => {
  deps = makeSubmissionsDeps();
  await publishStory(deps);
  vi.mocked(getContainer).mockReturnValue(
    buildContainer(config, {
      pool: {} as unknown as Pool,
      logger: deps.logger,
      submissions: deps,
      definitions: deps.definitions,
      media: deps.media,
    }),
  );
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

function req(path: string, body: Record<string, string | File>, cookie?: string): Request {
  const form = new FormData();
  for (const [name, value] of Object.entries(body)) form.append(name, value);
  const headers = new Headers();
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

  it("restarts by clearing the cookie", async () => {
    const res = await restart(
      new Request("https://forms.example.com/f/story-form/restart"),
      params({}),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/f/story-form");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
