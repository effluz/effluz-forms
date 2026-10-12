import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Jarred {
  value: string;
  options: Record<string, unknown>;
}

const request = vi.hoisted(() => ({ jar: new Map<string, Jarred>() }));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = request.jar.get(name)?.value;
        return value === undefined || value === "" ? undefined : { name, value };
      },
      set: (name: string, value: string, options: Record<string, unknown> = {}) => {
        request.jar.set(name, { value, options });
      },
    }),
  headers: () => Promise.resolve(new Headers({ "accept-language": "es" })),
}));
// Next's redirect() throws to end the action; the sentinel stands in.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import {
  makeSubmissionsDeps,
  publishStory,
  type FakeSubmissionsDeps,
} from "@/modules/submissions/application/testing/fakes";
import { decodeFillPostState } from "@/modules/submissions/presentation/cookies";
import { consentTextVersion } from "@/shared/domain/form-model";
import type { LocalizedText } from "@/shared/domain/localized-text";
import { postPage } from "./actions";

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

const OPTIONS = {
  path: "/f/story-form",
  httpOnly: true,
  sameSite: "lax",
  secure: false,
  maxAge: 86_400,
};

let deps: FakeSubmissionsDeps;
const jar = request.jar;

beforeEach(async () => {
  jar.clear();
  deps = makeSubmissionsDeps();
  await publishStory(deps);
  vi.mocked(getContainer).mockReturnValue(
    buildContainer(config, {
      pool: {} as unknown as Pool,
      submissions: deps,
      definitions: deps.definitions,
      media: deps.media,
    }),
  );
});

function form(fields: Record<string, string | File>): FormData {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return body;
}

const minuteAgo = (): string => new Date(deps.clock.now().getTime() - 60_000).toISOString();

describe("postPage", () => {
  it("creates the record on page 1 and redirects with the cookie", async () => {
    await expect(
      postPage(
        "story-form",
        form({
          _page: "page_contact",
          _action: "next",
          _rendered: deps.clock.now().toISOString(),
          "website-url": "",
          f_name: "Ana Prueba",
          f_baby: "no_opt",
        }),
      ),
    ).rejects.toThrow("REDIRECT /f/story-form");
    const cookie = jar.get("effluz_fill");
    expect(cookie?.value).toMatch(/^[0-9a-f-]{36}$/);
    expect(cookie?.options).toEqual(OPTIONS);
    expect(deps.inProgress.rows.size).toBe(1);
  });

  it("redirects a refused page to ?refused=<at>, the refused file in the state cookie only", async () => {
    await postPage(
      "story-form",
      form({ _page: "page_contact", _action: "next", f_name: "Ana Prueba", f_baby: "yes_opt" }),
    ).catch(() => undefined);
    const at = deps.clock.now().getTime();
    await expect(
      postPage(
        "story-form",
        form({ _page: "page_baby", _action: "next", f_photos: new File(["hello"], "notes.txt") }),
      ),
    ).rejects.toThrow(`REDIRECT /f/story-form?refused=${String(at)}`);
    const state = jar.get("effluz_fill_state");
    expect(state?.options).toEqual({ ...OPTIONS, maxAge: 600 });
    expect(decodeFillPostState(state?.value, String(at))).toEqual({
      at,
      page: 2,
      refusedFiles: [{ field: "f_photos", code: "file_wrong_type", name: "notes.txt", params: {} }],
    });
    expect(JSON.stringify([...deps.inProgress.rows.values()])).not.toContain("notes.txt");
  });

  it("sends an expired cookie to the expired screen and clears it", async () => {
    jar.set("effluz_fill", { value: "00000000-0000-4000-8000-0000000000aa", options: {} });
    await expect(
      postPage(
        "story-form",
        form({ _page: "page_contact", _action: "next", f_name: "Ana Prueba", f_baby: "no_opt" }),
      ),
    ).rejects.toThrow("REDIRECT /f/story-form?expired=1");
    expect(jar.get("effluz_fill")).toEqual({ value: "", options: { ...OPTIONS, maxAge: 0 } });
  });

  it("submits a one-page path end to end and sets the done cookie", async () => {
    await postPage(
      "story-form",
      form({
        _page: "page_contact",
        _action: "next",
        _rendered: minuteAgo(),
        f_name: "Ana Prueba",
        f_baby: "no_opt",
      }),
    ).catch(() => undefined);
    const [record] = [...deps.inProgress.rows.values()];
    const token = record?.submitToken ?? "";
    await expect(
      postPage(
        "story-form",
        form({ _page: "page_consent", _action: "submit", _token: token, f_consent: "accepted" }),
      ),
    ).rejects.toThrow("REDIRECT /f/story-form");
    expect(jar.get("effluz_fill")?.value).toBe(`done.${token}`);
    const submissions = [...deps.submissions.rows.values()];
    expect(submissions).toHaveLength(1);
    const version = await deps.versions.get(deps.definitions, submissions[0]?.versionId ?? "");
    const consent = version?.document.pages
      .flatMap((p) => p.fields)
      .find((f) => f.key === "f_consent")?.settings as { text: LocalizedText };
    expect(submissions[0]?.consent?.textVersion).toBe(consentTextVersion(consent.text));
  });

  it("clears the state cookie once a post goes through", async () => {
    await postPage(
      "story-form",
      form({ _page: "page_contact", _action: "next", f_name: "Ana Prueba", f_baby: "yes_opt" }),
    ).catch(() => undefined);
    await postPage(
      "story-form",
      form({ _page: "page_baby", _action: "next", f_photos: new File(["hello"], "notes.txt") }),
    ).catch(() => undefined);
    await expect(
      postPage("story-form", form({ _page: "page_baby", _action: "back" })),
    ).rejects.toThrow(/^REDIRECT \/f\/story-form$/);
    expect(jar.get("effluz_fill_state")).toEqual({ value: "", options: { ...OPTIONS, maxAge: 0 } });
  });

  it("redirects a malformed post back to the page and stores nothing", async () => {
    await expect(
      postPage(
        "story-form",
        form({ _page: "page_contact", _action: "jump", f_name: "Ana Prueba", f_baby: "no_opt" }),
      ),
    ).rejects.toThrow(/^REDIRECT \/f\/story-form$/);
    expect(deps.inProgress.rows.size).toBe(0);
  });
});
