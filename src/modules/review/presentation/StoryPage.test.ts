import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { settingsSchema, type Form, type FormVersion } from "@/modules/definitions/application";
import { literalPattern } from "@/shared/presentation/ConfirmForm";
import {
  asKey,
  fieldTypes,
  type Field,
  type FieldTypeId,
  type Version,
} from "@/shared/domain/form-model";
import type { LocalizedText } from "@/shared/domain/localized-text";
import {
  EMPTY_QUERY,
  type AnswerView,
  type FormContext,
  type ListQuery,
  type StoryView,
} from "../application";
import { listHref } from "./list-view";
import { StoryNotFound } from "./StoryNotFound";
import { StoryPage } from "./StoryPage";
import {
  STORY_DONE,
  STORY_ERRORS,
  parseStoryParams,
  storyPath,
  type StoryParams,
} from "./story-params";

const ID = "00000001-0000-4000-8000-000000000001";
const BASE = `/admin/forms/${ID}/submissions/ST-0001`;

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

function context(postPlan = false): FormContext {
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

function field(key: string, type: FieldTypeId, label: LocalizedText, settings?: unknown): Field {
  return {
    key: asKey(key),
    type,
    label,
    required: false,
    personal: false,
    validation: [],
    settings: settings ?? fieldTypes[type].fixtures.settings[0],
  };
}

function answer(f: Field, over: Partial<AnswerView> = {}): AnswerView {
  return {
    field: f,
    languages: "bilingual",
    answer: undefined,
    corrected: null,
    curatable: false,
    maxLength: null,
    ...over,
  };
}

const NAME = field("f_name", "long_text", { en: "Your story", es: "Tu historia" });
const CITY = field("f_city", "short_text", { en: "City", es: "Ciudad" });
const CHOICE_SETTINGS = {
  options: [
    { key: asKey("opt_yes"), label: { en: "Yes please", es: "Sí, por favor" } },
    { key: asKey("opt_no"), label: { en: "No thanks", es: "No, gracias" } },
  ],
  display: "radio",
};
const CONTACT = field(
  "f_contact",
  "single_choice",
  { en: "May we contact you?", es: "¿Podemos contactarte?" },
  CHOICE_SETTINGS,
);

const CORRECTED_AT = new Date("2026-10-17T15:30:00Z");

function storyView(over: Partial<StoryView> = {}): StoryView {
  return {
    ctx: context(),
    submissionId: "00000002-0000-4000-8000-000000000002",
    reference: "ST-0001",
    receivedAt: new Date("2026-10-16T14:00:00Z"),
    versionNumber: 1,
    locale: "es",
    status: "viewed",
    postUrl: null,
    plannedOn: null,
    publishedOn: null,
    pages: [
      {
        key: "p_story",
        title: { en: "Your story", es: "Tu historia" },
        answers: [
          answer(NAME, {
            answer: "Nacio en el hospital",
            corrected: { text: "Nació en el hospital", by: "owner@example.com", at: CORRECTED_AT },
            curatable: true,
            maxLength: 5000,
          }),
          answer(CITY, { answer: "Ciudad Ejemplo", curatable: true, maxLength: 200 }),
        ],
      },
      {
        key: "p_contact",
        title: { en: "Contact", es: "Contacto" },
        answers: [answer(CONTACT, { answer: "opt_yes" })],
      },
    ],
    photos: [],
    checks: { chosen: [], photosEditedFor: null, textCheckedAt: null },
    readiness: { photosChosen: false, photosEdited: false, textChecked: false, done: 0 },
    editedStale: false,
    photosEditedBy: null,
    textCheckedBy: null,
    consent: {
      textVersion: "0123456789abcdef",
      acceptedAt: new Date("2026-10-16T13:58:00Z"),
      text: null,
    },
    deadJobs: [],
    activity: [],
    neighbours: { newer: null, older: null },
    ...over,
  } as StoryView;
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

/** The form whose action is `action`, from its opening tag to its end. */
const formTo = (html: string, action: string) => between(html, `action="${action}"`, "</form>");

describe("StoryPage", () => {
  it("has one h1, the breadcrumb and the facts", () => {
    const query: ListQuery = { ...EMPTY_QUERY, status: "new" };
    const html = render(storyView(), { query });
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(textOf(between(html, "<h1", "</h1>"))).toBe("ST-0001");
    const crumbs = between(html, "<nav", "</nav>");
    expect(textOf(crumbs)).toMatch(/Forms.*Stories.*Historias.*ST-0001/);
    expect(tags(crumbs, "a", 'href="/admin/forms"')).toHaveLength(1);
    expect(tags(crumbs, "span", 'aria-current="page"')).toHaveLength(1);
    expect(html).toContain("Received 2026-10-16 09:00 America/Panama");
    expect(html).toContain("2026-10-16 14:00 UTC");
    expect(html).toContain("Version 1");
    expect(html).toContain("Sent in Spanish");
    expect(html).toContain("Enviada en español");
    expect(html).toMatch(/>Viewed<span lang="es"[^>]*>Vista</);
    const back = tags(html, "a", `href="${amp(listHref(ID, query))}"`);
    expect(back).toHaveLength(1);
    expect(html).toContain("Back to the list");
  });

  it("links Newer and Older with the list's filters, and leaves out a missing one", () => {
    const query: ListQuery = { ...EMPTY_QUERY, status: "new" };
    const html = render(storyView({ neighbours: { newer: "ST-0003", older: null } }), { query });
    expect(
      tags(html, "a", `href="/admin/forms/${ID}/submissions/ST-0003?status=new"`),
    ).toHaveLength(1);
    expect(html).toContain("Newer");
    expect(html).not.toContain(">Older<");
    expect(html).not.toContain("Más antigua");
  });

  it("groups answers under page titles through their displays", () => {
    const html = render(storyView());
    const headings = (html.match(/<h2\b[^>]*>.*?<\/h2>/g) ?? []).map(textOf);
    expect(headings).toContain("Your story Tu historia");
    expect(headings).toContain("Contact Contacto");
    expect(html).toContain("Nació en el hospital");
    expect(html).toContain("Ciudad Ejemplo");
    expect(html).toContain("Yes please");
    expect(html).toContain("Sí, por favor");
    expect(textOf(html)).toContain("City Ciudad");
    expect(html.indexOf("Your story")).toBeLessThan(html.indexOf("Contacto"));
  });

  it("tags corrected answers and offers Compare, Edit and Revert", () => {
    const query: ListQuery = { ...EMPTY_QUERY, status: "edited" };
    const html = render(storyView(), { query });
    expect(html).toMatch(
      /<span class="[^"]*"[^>]*>Edited<span lang="es"[^>]*>Editada<\/span><\/span>/,
    );
    expect(html).toContain("Corrected by owner@example.com on 2026-10-17 10:30 America/Panama");
    const compare = storyPath(ID, "ST-0001", query, { compare: "f_name" });
    const editName = storyPath(ID, "ST-0001", query, { edit: "f_name" });
    const editCity = storyPath(ID, "ST-0001", query, { edit: "f_city" });
    expect(tags(html, "a", `href="${amp(compare)}"`)).toHaveLength(1);
    expect(tags(html, "a", `href="${amp(editName)}"`)).toHaveLength(1);
    expect(tags(html, "a", `href="${amp(editCity)}"`)).toHaveLength(1);
    expect(html).toContain("Compare with original");
    // The city is curatable but uncorrected: Edit only. The choice has neither.
    expect(html.match(/Compare with original/g)).toHaveLength(1);
    expect(html.match(/>Edited</g)).toHaveLength(1);
    expect(tags(html, "a", "edit=f_contact")).toHaveLength(0);
    expect(tags(html, "a", "compare=f_contact")).toHaveLength(0);
  });

  it("opens the editor in two labelled columns", () => {
    const html = render(storyView(), { edit: "f_name" });
    const form = formTo(html, `${BASE}/correction`);
    expect(tags(html, "form", 'method="post"', `action="${BASE}/correction"`)).toHaveLength(1);
    expect(form).toContain("Original");
    expect(form).toContain("Nacio en el hospital");
    const [area] = tags(form, "textarea", 'name="text"', "required", 'maxLength="5000"');
    expect(area).toBeDefined();
    const areaId = attr(area ?? "", "id");
    expect(tags(form, "label", `for="${areaId ?? ""}"`)).toHaveLength(1);
    expect(textOf(between(form, `for="${areaId ?? ""}"`, "</label>"))).toContain("Corrected");
    expect(form).toContain("Nació en el hospital</textarea>");
    expect(form).toContain("Fix spelling, grammar and punctuation.");
    expect(form).toContain("Save correction");
    expect(tags(form, "input", 'type="hidden"', 'name="field"', 'value="f_name"')).toHaveLength(1);
    expect(tags(form, "input", 'type="hidden"', 'name="csrf"', 'value="csrf-token"')).toHaveLength(
      1,
    );
    expect(tags(form, "input", 'type="hidden"', 'name="back"')).toHaveLength(1);
    expect(tags(form, "a", `href="${BASE}"`)).toHaveLength(1);
    expect(textOf(between(form, `href="${BASE}"`, "</a>"))).toContain("Cancel");
    // The read-only answer block is replaced, not repeated.
    expect(html.match(/Nació en el hospital/g)).toHaveLength(1);
    expect(tags(html, "a", "compare=f_name")).toHaveLength(0);
  });

  it("shows the error under the editor", () => {
    const html = render(storyView(), { edit: "f_name", error: "correction_too_long", n: 5000 });
    const form = formTo(html, `${BASE}/correction`);
    const [area] = tags(form, "textarea", 'aria-invalid="true"');
    expect(area).toBeDefined();
    const described = (attr(area ?? "", "aria-describedby") ?? "").split(" ");
    const errorId = described.find((id) =>
      textOf(between(form, `id="${id}"`, "</p>")).includes("Use at most 5000 characters."),
    );
    expect(errorId).toBeDefined();
    expect(form).toContain("Usa como máximo 5000 caracteres.");
  });

  it("compares with marked, focusable changes", () => {
    const html = render(storyView(), { compare: "f_name" });
    const dels = html.match(/<del tabindex="0">.*?<\/del>/g) ?? [];
    const inss = html.match(/<ins tabindex="0">.*?<\/ins>/g) ?? [];
    expect(dels).toHaveLength(1);
    expect(inss).toHaveLength(1);
    expect(dels[0]).toMatch(
      /<span class="[^"]*">Removed<span lang="es"[^>]*>Quitado<\/span> <\/span>/,
    );
    expect(dels[0]).toContain("Nacio");
    expect(inss[0]).toMatch(
      /<span class="[^"]*">Added<span lang="es"[^>]*>Agregado<\/span> <\/span>/,
    );
    expect(inss[0]).toContain("Nació");
    const status = between(html, 'role="status"', "</p>");
    expect(status).toContain("1 change");
    expect(status).not.toContain("1 changes");
    expect(status).toContain("1 cambio");
    expect(
      tags(html, "a", `href="${amp(storyPath(ID, "ST-0001", EMPTY_QUERY, { edit: "f_name" }))}"`),
    ).toHaveLength(1);
    const revert = storyPath(ID, "ST-0001", EMPTY_QUERY, { action: "revert", field: "f_name" });
    expect(tags(html, "a", `href="${amp(revert)}"`)).toHaveLength(1);

    const same = render(
      storyView({
        pages: [
          {
            key: "p_story",
            title: { en: "Your story", es: "Tu historia" },
            answers: [
              answer(NAME, {
                answer: "Igual",
                corrected: { text: "Igual", by: null, at: null },
                curatable: true,
              }),
            ],
          },
        ],
      }),
      { compare: "f_name" },
    );
    expect(between(same, 'role="status"', "</p>")).toContain("No differences from the original");
    expect(same).not.toContain("<ins");
    expect(same).not.toContain("<del");
  });

  it("confirms a revert in an in-page dialog", () => {
    const html = render(storyView(), { action: "revert", field: "f_name" });
    const box = dialog(html);
    expect(box).not.toBe("");
    const open = tags(box, "section")[0] ?? "";
    const titleId = attr(open, "aria-labelledby") ?? "";
    const bodyId = attr(open, "aria-describedby") ?? "";
    expect(box).toContain(`id="${titleId}"`);
    expect(textOf(between(box, `id="${bodyId}"`, "</p>"))).toContain(
      'Remove the corrected version of "Your story" and show the original again?',
    );
    expect(textOf(box)).toContain(
      '¿Quitar la versión corregida de "Tu historia" y volver a mostrar el original?',
    );
    const form = formTo(box, `${BASE}/revert`);
    expect(tags(form, "input", 'name="field"', 'value="f_name"')).toHaveLength(1);
    expect(tags(form, "input", 'name="csrf"', 'value="csrf-token"')).toHaveLength(1);
    expect(textOf(between(form, "<button", "</button>"))).toContain("Revert to original");
  });

  it("warns about dead jobs with Try again", () => {
    const html = render(
      storyView({
        deadJobs: [
          { id: "job-1", type: "media.upload" },
          { id: "job-2", type: "email.staff_notification" },
        ],
      }),
    );
    expect(textOf(html)).toContain("Something did not finish for this story");
    expect(html).toMatch(/<h2\b[^>]*>Something did not finish for this story/);
    expect(html).toContain("A photo or video has not reached Dropbox.");
    expect(html).toContain("An email was not sent.");
    const form = formTo(html, `${BASE}/retry`);
    expect(tags(form, "input", 'name="csrf"', 'value="csrf-token"')).toHaveLength(1);
    expect(textOf(between(form, "<button", "</button>"))).toContain("Try again");
    expect(render(storyView())).not.toContain("Something did not finish");
  });

  it("shows each flash and refusal in words", () => {
    const view = storyView({ plannedOn: "2026-10-21" });
    const doneWords: Record<(typeof STORY_DONE)[number], string> = {
      saved: "Correction saved",
      reverted: "The original is shown again",
      published: "Marked as published",
      unpublished: "No longer marked as published",
      unpublished_waiting: "Its day now belongs to ST-0002, so it moved to Waiting for a date.",
      photos_added: "2 files added",
      photo_removed: "Photo removed",
      planned: "Planned for 2026-10-21",
      plan_cleared: "Moved to Waiting for a date",
      retried: "Trying again. Reload in a minute to see the result.",
      check_saved: "Check saved",
      choice_saved: "Photo choice saved",
    };
    for (const done of STORY_DONE) {
      const html = render(view, { done, n: 2, other: "ST-0002" });
      const status = between(html, 'role="status"', "</div>");
      expect(status, done).toContain(doneWords[done]);
    }
    expect(
      between(render(view, { done: "photos_added", n: 1 }), 'role="status"', "</div>"),
    ).toContain("1 file added");
    const errorWords: Record<(typeof STORY_ERRORS)[number], string> = {
      correction_blank: "Write the corrected text, or cancel to keep the original.",
      correction_too_long: "Use at most 3 characters.",
      post_url_invalid: "Use a link that starts with https://.",
      not_confirmed: "Tick the box to confirm the sender sent these for this story.",
      source_invalid: "Choose where the photos came from.",
      no_files: "Choose at least one file.",
      too_many_files: "Upload at most 3 files at a time.",
      staff_photos_max: "This story already has the most added photos allowed (3).",
      file_too_large: "File 3 is larger than 10 MB. Nothing was added.",
      file_wrong_type:
        "File 3 is not a JPEG, PNG, WebP or HEIC photo, or an MP4 or MOV video. Nothing was added.",
      file_unreadable: "File 3 could not be read. Nothing was added.",
      consent_missing:
        "Adding photos is off until the form publishes a consent text that covers photos sent later.",
      no_photos_chosen: "Choose at least one photo first.",
      date_invalid: "Enter a date as YYYY-MM-DD.",
      published: "A published story stays on the day it went out.",
      reference_mismatch: "The reference did not match. Nothing was deleted.",
    };
    for (const error of STORY_ERRORS) {
      const html = render(view, { error, n: 3 });
      const alert = between(html, 'role="alert"', "</div>");
      expect(alert, error).toContain(errorWords[error]);
    }
  });

  it("keeps consent collapsed with its version and time", () => {
    const html = render(storyView());
    const details = between(html, "<details", "</details>");
    expect(details).not.toContain(" open");
    expect(details).toMatch(/<summary\b[^>]*>.*Consent/);
    expect(details).toContain(
      "Accepted 2026-10-16 08:58 America/Panama, text version 0123456789abcdef",
    );
    expect(details).toContain(
      "Aceptado el 2026-10-16 08:58 America/Panama, versión del texto 0123456789abcdef",
    );
  });

  it("lists activity with plain-word actions", () => {
    const html = render(
      storyView({
        activity: [
          {
            id: "a2",
            action: "photo_viewed",
            actorEmail: "owner@example.com",
            targetId: "00000002-0000-4000-8000-000000000002",
            ip: "203.0.113.9",
            details: null,
            at: new Date("2026-10-17T16:00:00Z"),
          },
          {
            id: "a1",
            action: "something_new",
            actorEmail: null,
            targetId: "00000002-0000-4000-8000-000000000002",
            ip: null,
            details: null,
            at: new Date("2026-10-17T15:00:00Z"),
          },
        ],
      }),
    );
    const activity = between(html, "Activity", "</section>");
    expect(activity).toContain("Photo viewed");
    expect(activity).toContain("Foto vista");
    expect(activity).toContain("something_new");
    expect(activity).toContain("owner@example.com");
    expect(activity).toContain("System");
    expect(activity.indexOf("Photo viewed")).toBeLessThan(activity.indexOf("something_new"));
    expect(render(storyView())).toContain("No activity yet.");
  });

  it("asks for the typed reference before deleting", () => {
    const html = render(storyView(), { action: "delete" });
    const box = dialog(html);
    expect(box).toContain(
      "Submission ST-0001 and its files in Dropbox will be deleted. This cannot be undone. Type the reference to confirm.",
    );
    const form = formTo(box, `${BASE}/delete`);
    const [input] = tags(form, "input", 'name="typed"', "required");
    expect(input).toBeDefined();
    expect(attr(input ?? "", "pattern")).toBe(literalPattern("ST-0001"));
    const inputId = attr(input ?? "", "id") ?? "";
    expect(textOf(between(form, `for="${inputId}"`, "</label>"))).toContain("Reference");
    expect(textOf(between(form, "<button", "</button>"))).toContain("Delete permanently");
    expect(tags(form, "input", 'name="csrf"', 'value="csrf-token"')).toHaveLength(1);
    const refused = dialog(render(storyView(), { action: "delete", error: "reference_mismatch" }));
    expect(refused).toContain("The reference did not match. Nothing was deleted.");
    expect(tags(refused, "input", 'name="typed"', 'aria-invalid="true"')).toHaveLength(1);
  });

  it("renders the not-found body", () => {
    const query: ListQuery = { ...EMPTY_QUERY, status: "new" };
    const html = renderToStaticMarkup(createElement(StoryNotFound, { formId: ID, query }));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(textOf(between(html, "<h1", "</h1>"))).toContain("Submission not found");
    const back = tags(html, "a", `href="${amp(listHref(ID, query))}"`);
    expect(back.length).toBeGreaterThan(0);
    expect(html).toContain("Back to the submissions");
  });

  it("escapes staff and sender text everywhere", () => {
    const evil = field("f_evil", "short_text", { en: "<b>x</b>", es: "<b>x</b>" });
    const view = storyView({
      pages: [
        {
          key: "p_evil",
          title: { en: "<i>page</i>", es: "<i>página</i>" },
          answers: [answer(evil, { answer: "<img src=x>", curatable: true })],
        },
      ],
    });
    for (const over of [{}, { edit: "f_evil" }, { action: "revert" as const, field: "f_evil" }]) {
      const html = render(view, over);
      expect(html).not.toContain("<b>x</b>");
      expect(html).not.toContain("<img src=x>");
      expect(html).not.toContain("<i>page</i>");
      expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    }
    expect(render(view)).toContain("&lt;img src=x&gt;");
  });
});
