import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { settingsSchema, type Form, type FormVersion } from "@/modules/definitions/application";
import { asKey, type Field, type Version } from "@/shared/domain/form-model";
import {
  EMPTY_QUERY,
  type AnswerPageView,
  type FormContext,
  type IsoDate,
  type PhotoView,
  type StoryView,
} from "../application";
import { StoryPage } from "./StoryPage";
import { parseStoryParams, storyPath, type StoryParams } from "./story-params";

const ID = "00000001-0000-4000-8000-000000000001";
const BASE = `/admin/forms/${ID}/submissions/ST-0001`;
const P1 = "00000003-0000-4000-8000-000000000001";
const TICKED_AT = new Date("2026-10-17T15:30:00Z");

function version(number: number): FormVersion {
  return {
    id: `version-${String(number)}`,
    formId: ID,
    number,
    document: {} as Version,
    publishedAt: new Date("2026-10-01T12:00:00Z"),
    publishedBy: null,
  };
}

function context(postPlan: boolean): FormContext {
  const form: Form = {
    id: ID,
    slug: "story-form",
    title: { en: "Stories", es: "Historias" },
    languages: "bilingual",
    status: "published",
    settings: settingsSchema.parse({ referencePrefix: "ST", usePostPlan: postPlan }),
    currentVersionId: "version-1",
    currentVersionNumber: 1,
    archivedAt: null,
    createdAt: new Date("2026-10-01T12:00:00Z"),
    updatedAt: new Date("2026-10-01T12:00:00Z"),
  };
  return { form, versions: [version(1)], postPlan, laterPhotosAllowed: postPlan };
}

const PHOTO: PhotoView = {
  mediaId: P1,
  kind: "image",
  status: "stored",
  durableKey: "forms/story-form/ST-0001/01-photos.jpg",
  chosen: true,
  origin: "sender",
  staff: null,
};

const STORY_FIELD: Field = {
  key: asKey("f_story"),
  type: "long_text",
  label: { en: "Your story", es: "Tu historia" },
  required: false,
  personal: false,
  validation: [],
  settings: {},
};

/** One page with one text answer, corrected or not. */
function pages(corrected: boolean): AnswerPageView[] {
  return [
    {
      key: "p_story",
      title: { en: "Your story", es: "Tu historia" },
      answers: [
        {
          field: STORY_FIELD,
          languages: "bilingual",
          answer: "Nacio en el hospital",
          corrected: corrected
            ? { text: "Nació en el hospital", by: "owner@example.com", at: TICKED_AT }
            : null,
          curatable: true,
          maxLength: 5000,
        },
      ],
    },
  ];
}

function storyView(over: Partial<StoryView> = {}): StoryView {
  return {
    ctx: context(true),
    submissionId: "00000002-0000-4000-8000-000000000002",
    reference: "ST-0001",
    receivedAt: new Date("2026-10-16T14:00:00Z"),
    versionNumber: 1,
    locale: "es",
    status: "viewed",
    postUrl: null,
    plannedOn: null,
    publishedOn: null,
    pages: [],
    photos: [PHOTO],
    checks: { chosen: [P1], photosEditedFor: null, textCheckedAt: null },
    readiness: {
      photosChosen: true,
      photosEdited: false,
      textChecked: false,
      ready: false,
      done: 1,
    },
    editedStale: false,
    photosEditedBy: null,
    textCheckedBy: null,
    consent: null,
    deadJobs: [],
    activity: [],
    neighbours: { newer: null, older: null },
    ...over,
  };
}

function params(over: Partial<StoryParams> = {}): StoryParams {
  return { ...parseStoryParams({}), ...over };
}

function render(view: StoryView, over: Partial<StoryParams> = {}): string {
  return renderToStaticMarkup(
    createElement(StoryPage, { view, params: params(over), csrfToken: "csrf-token" }),
  );
}

/** The opening tags of every `element` carrying all of `attrs`, in any attribute order. */
const tags = (html: string, element: string, ...attrs: string[]) =>
  (html.match(new RegExp(`<${element}\\b[^>]*>`, "g")) ?? []).filter((tag) =>
    attrs.every((attr) => tag.includes(attr)),
  );

const between = (html: string, from: string, to: string): string => {
  const start = html.indexOf(from);
  return start < 0 ? "" : html.slice(start, html.indexOf(to, start) + to.length);
};

const dialog = (html: string) => between(html, '<section role="dialog"', "</section>");
/** The text of some markup, tags dropped and the entities React writes decoded. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
const amp = (href: string) => href.replace(/&/g, "&amp;");

/** Every form whose action is `action`, each from its opening tag to its end. */
const formsTo = (html: string, action: string) =>
  html
    .split(`action="${action}"`)
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf("</form>")));

/** The readiness checks: the content of each row of the list in the panel. */
const checkRows = (html: string) =>
  between(between(html, 'id="readiness"', "</ul>"), "<ul", "</ul>")
    .split("<li")
    .slice(1)
    .map((row) => row.slice(row.indexOf(">") + 1));

/** The text of the label for the control with id `id`. */
const labelOf = (html: string, id: string) => {
  const tag = between(html, `for="${id}"`, "</label>");
  return textOf(tag.slice(tag.indexOf(">") + 1));
};

/** The text of the element with id `id`, assuming it is a paragraph. */
const described = (html: string, id: string) => {
  const tag = between(html, `id="${id}"`, "</p>");
  return textOf(tag.slice(tag.indexOf(">") + 1));
};

describe("StoryPage readiness, plan and publishing", () => {
  it("lists the three checks with words and icons", () => {
    const html = render(
      storyView({
        readiness: {
          photosChosen: true,
          photosEdited: false,
          textChecked: true,
          ready: false,
          done: 2,
        },
      }),
    );
    const panel = between(html, 'id="readiness"', "</ul>");
    expect(textOf(panel)).toContain("Ready to post? ¿Lista para publicar?");
    expect(textOf(panel)).toContain("Not ready: 2 of 3 done No lista: 2 de 3 hechos");
    const rows = checkRows(html);
    expect(rows).toHaveLength(3);
    const [chosen, edited, text] = rows.map((row) => row.slice(0, row.indexOf("</li>")));
    expect(textOf(chosen ?? "")).toMatch(/^Photos chosen Fotos elegidas Done Hecho/);
    expect(textOf(edited ?? "")).toMatch(
      /^Photos edited in Canva Fotos editadas en Canva Missing Falta/,
    );
    expect(textOf(text ?? "")).toMatch(/^Text checked Texto revisado Done Hecho/);
    const icon = (row: string) => between(row, "<svg", "</svg>");
    for (const row of [chosen, edited, text])
      expect(icon(row ?? "")).toContain('aria-hidden="true"');
    // A tick for done, a cross for missing: the shapes differ, not only the colour.
    expect(icon(chosen ?? "")).toBe(icon(text ?? ""));
    expect(icon(chosen ?? "")).not.toBe(icon(edited ?? ""));

    const ready = render(
      storyView({
        readiness: {
          photosChosen: true,
          photosEdited: true,
          textChecked: true,
          ready: true,
          done: 3,
        },
      }),
    );
    const summary = textOf(between(ready, 'id="readiness"', "</ul>"));
    expect(summary).toContain("Ready Lista");
    expect(summary).not.toContain("Not ready");
  });

  it("offers each tick as a button that names its effect", () => {
    const open = render(storyView());
    const forms = formsTo(open, `${BASE}/check`);
    const edit = forms.find((f) => f.includes('value="photos_edited"')) ?? "";
    expect(tags(edit, "input", 'name="check"', 'value="photos_edited"')).toHaveLength(1);
    expect(tags(edit, "input", 'name="value"', 'value="1"')).toHaveLength(1);
    expect(tags(edit, "input", 'name="csrf"', 'value="csrf-token"')).toHaveLength(1);
    expect(textOf(edit)).toContain("Mark photos as edited Marcar fotos como editadas");
    const textForm = forms.find((f) => f.includes('value="text_checked"')) ?? "";
    expect(tags(textForm, "input", 'name="value"', 'value="1"')).toHaveLength(1);
    expect(textOf(textForm)).toContain("Mark text as checked Marcar texto como revisado");
    expect(open).not.toContain("owner@example.com");

    const ticked = render(
      storyView({
        checks: { chosen: [P1], photosEditedFor: [P1], textCheckedAt: TICKED_AT },
        readiness: {
          photosChosen: true,
          photosEdited: true,
          textChecked: true,
          ready: true,
          done: 3,
        },
        photosEditedBy: { by: "owner@example.com", at: TICKED_AT },
        textCheckedBy: { by: "owner@example.com", at: TICKED_AT },
      }),
    );
    const done = formsTo(ticked, `${BASE}/check`);
    const unedit = done.find((f) => f.includes('value="photos_edited"')) ?? "";
    expect(tags(unedit, "input", 'name="value"', 'value="0"')).toHaveLength(1);
    expect(textOf(unedit)).toContain("Photos not edited yet Las fotos aún no están editadas");
    const uncheck = done.find((f) => f.includes('value="text_checked"')) ?? "";
    expect(tags(uncheck, "input", 'name="value"', 'value="0"')).toHaveLength(1);
    expect(textOf(uncheck)).toContain("Text not checked yet El texto aún no está revisado");
    const panel = textOf(between(ticked, 'id="readiness"', "</ul>"));
    expect(panel.match(/owner@example\.com, 2026-10-17 10:30 America\/Panama/g)).toHaveLength(2);
    expect(ticked).not.toContain("Mark photos as edited");
  });

  it("explains a stale edited tick", () => {
    const stale = "The chosen photos changed after they were edited.";
    expect(render(storyView())).not.toContain(stale);
    const html = render(storyView({ editedStale: true }));
    expect(textOf(between(html, 'id="readiness"', "</ul>"))).toContain(
      `${stale} Tick again once the new set is edited.`,
    );
  });

  it("plans with a labelled date field", () => {
    const html = render(storyView({ plannedOn: "2026-10-21" }));
    const forms = formsTo(html, `${BASE}/plan`);
    expect(forms).toHaveLength(2);
    const [plan, clear] = forms;
    const input = tags(plan ?? "", "input", 'type="date"', 'name="date"', 'value="2026-10-21"');
    expect(input).toHaveLength(1);
    const id = attr(input[0] ?? "", "id") ?? "";
    expect(labelOf(plan ?? "", id)).toBe("Planned date Fecha planificada");
    const hints = (attr(input[0] ?? "", "aria-describedby") ?? "").split(" ");
    expect(hints.map((h) => described(plan ?? "", h))).toContain(
      "One story per day. Format YYYY-MM-DD. Una historia por día. Formato AAAA-MM-DD.",
    );
    expect(tags(plan ?? "", "input", 'name="csrf"', 'value="csrf-token"')).toHaveLength(1);
    expect(textOf(plan ?? "")).toContain("Plan Planificar");
    expect(tags(clear ?? "", "input", 'name="date"', 'value=""')).toHaveLength(1);
    expect(textOf(clear ?? "")).toContain("Remove the date Quitar la fecha");
    expect(html.indexOf('id="plan"')).toBeGreaterThan(html.indexOf('id="readiness"'));

    const unplanned = render(storyView());
    const one = formsTo(unplanned, `${BASE}/plan`);
    expect(one).toHaveLength(1);
    expect(tags(one[0] ?? "", "input", 'type="date"', 'name="date"', 'value=""')).toHaveLength(1);
    expect(unplanned).not.toContain("Remove the date");

    const refused = render(storyView(), { error: "date_invalid" });
    const date = tags(refused, "input", 'type="date"')[0] ?? "";
    expect(date).toContain('aria-invalid="true"');
    const ids = (attr(date, "aria-describedby") ?? "").split(" ");
    expect(ids.map((h) => described(refused, h))).toContain(
      "Enter a date as YYYY-MM-DD. Escribe una fecha como AAAA-MM-DD.",
    );
  });

  it("asks on a conflict", () => {
    const conflict = { date: "2026-10-21" as IsoDate, ref: "ST-0002", canSwap: true };
    const html = render(storyView(), { conflict });
    const ask = dialog(html);
    expect(textOf(ask)).toContain("ST-0002 is already planned for 2026-10-21.");
    expect(textOf(ask)).toContain("ST-0002 ya está planificada para el 2026-10-21.");
    const form = formsTo(ask, `${BASE}/plan`)[0] ?? "";
    expect(tags(form, "input", 'name="date"', 'value="2026-10-21"')).toHaveLength(1);
    expect(tags(form, "input", 'name="expected"', 'value="ST-0002"')).toHaveLength(1);
    expect(tags(form, "input", 'name="csrf"', 'value="csrf-token"')).toHaveLength(1);
    const swap = tags(form, "button", 'name="resolution"', 'value="swap"');
    expect(swap).toHaveLength(1);
    expect(textOf(form)).toContain("Swap the two dates Intercambiar las fechas");
    expect(tags(form, "button", 'name="resolution"', 'value="move"')).toHaveLength(1);
    expect(textOf(form)).toContain(
      "Move ST-0002 to Waiting for a date Pasar ST-0002 a Esperando fecha",
    );
    expect(tags(ask, "a", `href="${BASE}"`)).toHaveLength(1);
    expect(textOf(ask)).toContain("Cancel Cancelar");

    const noSwap = dialog(render(storyView(), { conflict: { ...conflict, canSwap: false } }));
    expect(tags(noSwap, "button", 'value="swap"')).toHaveLength(0);
    expect(noSwap).not.toContain("Swap the two dates");
    expect(tags(noSwap, "button", 'name="resolution"', 'value="move"')).toHaveLength(1);
  });

  it("shows Planned and published days in words", () => {
    const planned = render(storyView({ plannedOn: "2026-10-21" }));
    expect(textOf(planned)).toContain("Planned · 2026-10-21");

    const published = render(
      storyView({
        status: "published",
        plannedOn: "2026-10-20",
        publishedOn: "2026-10-20",
        postUrl: "https://social.example.com/p/123",
      }),
    );
    expect(textOf(published)).not.toContain("Planned · ");
    expect(textOf(published)).toContain("Published on 2026-10-20 Publicada el 2026-10-20");
    const link = tags(published, "a", 'href="https://social.example.com/p/123"');
    expect(link).toHaveLength(1);
    expect(attr(link[0] ?? "", "rel")).toBe("noopener noreferrer");
    expect(link[0]).not.toContain("target=");
    expect(textOf(between(published, 'href="https://social.example.com/p/123"', "</a>"))).toContain(
      "Open the post Abrir la publicación",
    );
    const unmark = storyPath(ID, "ST-0001", EMPTY_QUERY, { action: "unpublish" });
    expect(tags(published, "a", `href="${amp(unmark)}"`)).toHaveLength(1);
    expect(textOf(published)).toContain("Unmark as published Quitar marca de publicada");
    expect(published).not.toContain("Mark as published<");

    const noLink = render(
      storyView({ status: "published", publishedOn: "2026-10-20", postUrl: null }),
    );
    expect(noLink).not.toContain("Open the post");
  });

  it("marks as published in a dialog with an optional https link", () => {
    const page = render(storyView());
    const mark = storyPath(ID, "ST-0001", EMPTY_QUERY, { action: "publish" });
    expect(tags(page, "a", `href="${amp(mark)}"`)).toHaveLength(1);
    expect(textOf(page)).toContain("Mark as published Marcar como publicada");
    expect(dialog(page)).toBe("");

    const html = render(storyView(), { action: "publish" });
    const ask = dialog(html);
    const form = formsTo(ask, `${BASE}/status`)[0] ?? "";
    expect(tags(form, "input", 'name="intent"', 'value="publish"')).toHaveLength(1);
    expect(tags(form, "input", 'name="csrf"', 'value="csrf-token"')).toHaveLength(1);
    const input = tags(form, "input", 'type="url"', 'name="post_url"');
    expect(input).toHaveLength(1);
    expect(input[0]).not.toContain("required");
    const id = attr(input[0] ?? "", "id") ?? "";
    expect(labelOf(form, id)).toBe(
      "Link to the post (optional) Enlace a la publicación (opcional)",
    );
    const hints = (attr(input[0] ?? "", "aria-describedby") ?? "").split(" ");
    expect(hints.map((h) => described(form, h))).toContain(
      "Starts with https:// Empieza con https://",
    );
    expect(textOf(form)).toContain("Confirm Confirmar");
    expect(tags(ask, "a", `href="${BASE}"`)).toHaveLength(1);
    expect(input[0]).not.toContain("aria-invalid");

    const refused = dialog(render(storyView(), { action: "publish", error: "post_url_invalid" }));
    const bad = tags(refused, "input", 'name="post_url"')[0] ?? "";
    expect(bad).toContain('aria-invalid="true"');
    const ids = (attr(bad, "aria-describedby") ?? "").split(" ");
    expect(ids.map((h) => described(refused, h))).toContain(
      "Use a link that starts with https://. Usa un enlace que empiece con https://.",
    );
  });

  it("unmarks after saying where the status goes", () => {
    const published = { status: "published", publishedOn: "2026-10-20" } as Partial<StoryView>;
    const edited = dialog(
      render(storyView({ ...published, pages: pages(true) }), { action: "unpublish" }),
    );
    expect(textOf(edited)).toContain("The status will return to Edited.");
    expect(edited).not.toContain("Viewed.");
    const form = formsTo(edited, `${BASE}/status`)[0] ?? "";
    expect(tags(form, "input", 'name="intent"', 'value="unpublish"')).toHaveLength(1);
    expect(tags(form, "input", 'name="csrf"', 'value="csrf-token"')).toHaveLength(1);
    expect(textOf(form)).toContain("Confirm Confirmar");
    expect(tags(edited, "a", `href="${BASE}"`)).toHaveLength(1);

    const viewed = dialog(
      render(storyView({ ...published, pages: pages(false) }), { action: "unpublish" }),
    );
    expect(textOf(viewed)).toContain("The status will return to Viewed.");
    expect(viewed).not.toContain("Edited.");

    // Nothing to unmark on a story that is not published.
    expect(dialog(render(storyView(), { action: "unpublish" }))).toBe("");
  });

  it("hides the plan parts on forms outside the post plan", () => {
    const html = render(
      storyView({
        ctx: context(false),
        plannedOn: "2026-10-21",
        readiness: {
          photosChosen: true,
          photosEdited: true,
          textChecked: true,
          ready: true,
          done: 3,
        },
      }),
      { conflict: { date: "2026-10-21", ref: "ST-0002", canSwap: true } },
    );
    expect(html).not.toContain('id="readiness"');
    expect(html).not.toContain('id="plan"');
    expect(html).not.toContain("Ready to post?");
    expect(formsTo(html, `${BASE}/plan`)).toHaveLength(0);
    expect(formsTo(html, `${BASE}/check`)).toHaveLength(0);
    expect(formsTo(html, `${BASE}/choice`)).toHaveLength(0);
    expect(dialog(html)).toBe("");
    expect(textOf(html)).not.toContain("Planned · ");
    expect(textOf(html)).toContain("Publishing Publicación");
    const mark = storyPath(ID, "ST-0001", EMPTY_QUERY, { action: "publish" });
    expect(tags(html, "a", `href="${amp(mark)}"`)).toHaveLength(1);
  });
});
