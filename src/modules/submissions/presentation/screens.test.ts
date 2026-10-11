import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { seedPublished } from "@/modules/definitions/application/testing/fakes";
import { asKey, buildDefaultRegistry, parseDraft } from "@/shared/domain/form-model";
import { makeSubmissionsDeps, publishStory } from "../application/testing/fakes";
import type { FakeSubmissionsDeps } from "../application/testing/fakes";
import { viewForm, type ViewResult } from "../application/view-form";
import { newInProgress, type InProgress } from "../domain/in-progress";
import { storyVersion } from "../domain/testing/versions";
import { refusedFileMessages } from "./field-views";
import type { FillPostState, PageFormAction, RefusedFileMessage } from "./page-form-state";
import { ErrorScreen, NotFoundScreen, RendererScreen } from "./Screens";

const registry = buildDefaultRegistry();
const noop: PageFormAction = () => Promise.resolve();
const RECORD_ID = "00000000-0000-4000-8000-0000000000aa";
const TOKEN = "00000000-0000-4000-8000-0000000000bb";

function screen(
  view: Exclude<ViewResult, { screen: "not_found" }>,
  slug = "story-form",
  refusedFiles: readonly RefusedFileMessage[] = [],
): string {
  return renderToStaticMarkup(
    createElement(RendererScreen, {
      view,
      slug,
      contact: "privacy@example.com",
      registry,
      formAction: noop,
      refusedFiles,
    }),
  );
}

async function pageHtml(acceptLanguage = "en") {
  const deps = makeSubmissionsDeps();
  await publishStory(deps);
  const view = await viewForm(deps, {
    slug: "story-form",
    state: { kind: "none" },
    acceptLanguage,
    expired: false,
  });
  if (view.screen === "not_found") throw new Error("not found");
  return { html: screen(view), deps, view };
}

async function storeRecord(deps: FakeSubmissionsDeps, over: Partial<InProgress> = {}) {
  const [form] = [...deps.definitions.store.forms.values()];
  if (!form?.currentVersionId) throw new Error("no form");
  const now = deps.clock.now();
  const record: InProgress = {
    ...newInProgress({
      id: RECORD_ID,
      formId: form.id,
      versionId: form.currentVersionId,
      locale: "en",
      pageKey: "page_contact",
      submitToken: TOKEN,
      startedAt: now,
      now: new Date(now.getTime() + 3_600_000),
    }),
    ...over,
  };
  await deps.inProgress.insert(await deps.uow.begin(), record);
  return record;
}

async function viewRecord(deps: FakeSubmissionsDeps) {
  const view = await viewForm(deps, {
    slug: "story-form",
    state: { kind: "record", id: RECORD_ID },
    acceptLanguage: null,
    expired: false,
  });
  if (view.screen !== "page") throw new Error(`expected a page, got ${view.screen}`);
  return view;
}

/** The opening tags of every `tag` element, so attributes can be checked without their order. */
function tagsOf(html: string, tag: string): string[] {
  return html.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? [];
}

describe("RendererScreen", () => {
  it("renders page 1 as a real form with skip link, one h1, progress, legend, fields, honeypot and Next", async () => {
    const { html } = await pageHtml();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('href="#content"');
    expect(html).toContain("Skip to form");
    expect(html).toMatch(/<form[^>]*id="page-form"/);
    expect(html).toContain("Page 1 of 2");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("Fields marked with * are required");
    expect(html).toMatch(/name="_page" value="page_contact"/);
    expect(html).toMatch(/name="_rendered" value="2026-10-10T09:00:00.000Z"/);
    // React writes `name` last and camel-cases autoComplete; HTML reads both the same.
    const honeypot = tagsOf(html, "input").find((tag) => tag.includes('name="website-url"')) ?? "";
    expect(honeypot).toContain('tabindex="-1"');
    expect(honeypot).toMatch(/autocomplete="off"/i);
    expect(html).not.toContain(">Back<");
    expect(html).toContain('value="next"');
    expect(html).toContain(
      "This form is run by Effluz. Answers are stored in the United States and deleted after 12 months.",
    );
    expect(html).toContain('href="mailto:privacy@example.com"');
  });

  it("puts the hidden default action first, so Enter means Next", async () => {
    const { html } = await pageHtml();
    expect(html.indexOf('value="next"')).toBeGreaterThan(-1);
    expect(html.indexOf('value="next"')).toBeLessThan(html.indexOf('value="language:es"'));
  });

  it("makes the first submit button a hidden Next, never a file Remove", async () => {
    const { deps } = await pageHtml();
    await storeRecord(deps, {
      pageKey: "page_baby",
      answers: { f_name: "Ana Prueba", f_baby: "yes_opt" },
      files: {
        f_photos: [
          {
            id: "00000000-0000-4000-8000-0000000000e1",
            stagingRef: "in-progress/r/a.jpg",
            kind: "image",
            contentType: "image/jpeg",
            size: 3000,
          },
        ],
      },
    });
    const html = screen(await viewRecord(deps));
    expect(html).toContain('value="remove:00000000-0000-4000-8000-0000000000e1"');
    const submits = tagsOf(html, "button").filter((tag) => tag.includes('type="submit"'));
    const first = submits[0] ?? "";
    expect(first).toContain('value="next"');
    expect(first).toContain('form="page-form"');
    expect(first).toContain('tabindex="-1"');
    expect(first).toContain('aria-hidden="true"');
    expect(first).not.toContain("remove:");
  });

  it("offers the other language, named in that language", async () => {
    const { html } = await pageHtml();
    const tag = tagsOf(html, "button").find((t) => t.includes('value="language:es"')) ?? "";
    expect(tag).toContain('form="page-form"');
    expect(tag).toContain('name="_action"');
    expect(tag).toContain('lang="es"');
    expect(html).toMatch(/<button[^>]*value="language:es"[^>]*>Español</);
  });

  it("shows the error summary with links and a count, and the messages under the fields", async () => {
    const { deps } = await pageHtml();
    await storeRecord(deps, {
      pending: {
        pageKey: "page_contact",
        raw: { f_email: "nope" },
        issues: [
          { code: "required", field: asKey("f_name") },
          { code: "email_syntax", field: asKey("f_email") },
        ],
      },
    });
    const html = screen(await viewRecord(deps));
    expect(html).toContain("Please fix 2 problems before continuing");
    expect(html).toMatch(/<div[^>]*role="alert"[^>]*data-error-summary/);
    expect(html).toContain('href="#f-f_name"');
    expect(html).toContain("Name is required");
    expect(html).toContain('value="nope"');
    expect(html.indexOf("Please fix 2 problems")).toBeLessThan(html.indexOf('id="f-f_name"'));
  });

  it("renders the confirmation, the closed screen in both languages, and not found", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const confirmation = await viewForm(deps, {
      slug: "story-form",
      state: { kind: "decoy", reference: "ST-1234" },
      acceptLanguage: "es",
      expired: false,
    });
    if (confirmation.screen === "not_found") throw new Error("not found");
    const done = screen(confirmation);
    expect(done).toContain("Gracias.");
    expect(done).toContain("Tu referencia: ");
    expect(done).toContain("ST-1234");
    expect(done).toContain("Puedes cerrar esta página.");
    expect(done).not.toContain("Llenar otro formulario");

    const [form] = [...deps.definitions.store.forms.values()];
    if (!form) throw new Error("no form");
    deps.definitions.store.forms.set(form.id, { ...form, status: "closed" });
    const closed = await viewForm(deps, {
      slug: "story-form",
      state: { kind: "none" },
      acceptLanguage: null,
      expired: false,
    });
    if (closed.screen === "not_found") throw new Error("not found");
    const closedHtml = screen(closed);
    expect(closedHtml).toContain("Este formulario está cerrado");
    expect(closedHtml).toMatch(/<span lang="en"[^>]*>This form is closed/);
    expect(closedHtml).not.toContain("<form");

    const notFound = renderToStaticMarkup(createElement(NotFoundScreen));
    expect(notFound).toContain("No encontramos este formulario");
    expect(notFound).not.toContain("Effluz. Answers are stored");
  });

  it("shows the refused files the page read from the cookie, in the summary and under the field", async () => {
    const { deps } = await pageHtml();
    await storeRecord(deps, {
      pageKey: "page_baby",
      answers: { f_name: "Ana Prueba", f_baby: "yes_opt" },
      pending: { pageKey: "page_baby", raw: {}, issues: [] },
    });
    const html = screen(await viewRecord(deps), "story-form", [
      { fieldKey: "f_photos", message: "notes.txt is not a supported type." },
    ]);
    expect(html).toContain("Please fix 1 problem before continuing");
    expect(html).toContain('<a href="#f-f_photos">notes.txt is not a supported type.</a>');
    expect(html).toMatch(/id="f_photos-error"[^>]*>[\s\S]*notes\.txt is not a supported type\./);
  });

  it("shows a multiple choice field's selection limits in its help", async () => {
    const deps = makeSubmissionsDeps();
    const parsed = parseDraft(
      {
        languages: "en",
        title: { en: "Probe" },
        confirmation: { screen: { en: "Thanks" } },
        pages: [
          {
            key: "page_pick",
            title: { en: "Probe" },
            fields: [
              {
                key: "f_pick",
                type: "multiple_choice",
                label: { en: "Probe" },
                validation: [{ rule: "min_selected", value: 2 }],
                settings: {
                  options: [
                    { key: "opt_a", label: { en: "A" } },
                    { key: "opt_b", label: { en: "B" } },
                    { key: "opt_c", label: { en: "C" } },
                  ],
                },
              },
            ],
          },
        ],
      },
      registry,
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    await seedPublished(deps.definitions, { slug: "probe-form", document: parsed.version });
    const view = await viewForm(deps, {
      slug: "probe-form",
      state: { kind: "none" },
      acceptLanguage: "en",
      expired: false,
    });
    if (view.screen === "not_found") throw new Error("not found");
    expect(screen(view, "probe-form")).toContain("Select at least 2 options for Probe");
  });

  it("gives the opening date in each language's own format", async () => {
    const deps = makeSubmissionsDeps();
    await seedPublished(deps.definitions, {
      slug: "later-form",
      document: storyVersion(),
      settings: { opensAt: "2026-12-01T17:00:00.000Z", timezone: "America/Panama" },
    });
    const view = await viewForm(deps, {
      slug: "later-form",
      state: { kind: "none" },
      acceptLanguage: null,
      expired: false,
    });
    expect(view.screen).toBe("not_open");
    if (view.screen === "not_found") throw new Error("not found");
    const html = screen(view, "later-form");
    expect(html).toContain("Abre el 1 de diciembre de 2026");
    expect(html).toContain("It opens on December 1, 2026");
  });
});

describe("ErrorScreen", () => {
  it("says what happened in both languages and offers Try again", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorScreen, { tryAgainHref: "/f/story-form" }),
    );
    expect(html).toContain("Algo salió mal");
    expect(html).toMatch(/<span lang="en"[^>]*>Something went wrong/);
    expect(html).toContain('href="/f/story-form"');
    expect(html).not.toContain("<form");
  });
});

describe("refusedFileMessages", () => {
  it("builds the cookie's messages for the page it names only", async () => {
    const { deps } = await pageHtml();
    await storeRecord(deps, {
      pageKey: "page_baby",
      answers: { f_name: "Ana Prueba", f_baby: "yes_opt" },
      pending: { pageKey: "page_baby", raw: {}, issues: [] },
    });
    const view = await viewRecord(deps);
    const state: FillPostState = {
      at: 1,
      page: 2,
      refusedFiles: [
        { field: "f_photos", code: "file_too_large", name: "a.jpg", params: { maxMb: 10 } },
        { field: "f_photos", code: "file_wrong_type", name: "", params: {} },
        { field: "f_name", code: "file_wrong_type", name: "x.txt", params: {} },
      ],
    };
    expect(refusedFileMessages(state, view, registry)).toEqual([
      { fieldKey: "f_photos", message: "a.jpg is larger than 10 MB" },
      {
        fieldKey: "f_photos",
        message:
          "File 2 is not a supported type. Use JPEG, PNG, WebP or HEIC photos, or MP4 or MOV videos",
      },
    ]);
    expect(refusedFileMessages({ ...state, page: 1 }, view, registry)).toEqual([]);
    expect(refusedFileMessages(null, view, registry)).toEqual([]);
  });
});
