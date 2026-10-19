import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { settingsSchema, type Form, type FormVersion } from "@/modules/definitions/application";
import type { Version } from "@/shared/domain/form-model";
import { EMPTY_QUERY, type FormContext, type PhotoView, type StoryView } from "../application";
import { StoryPage } from "./StoryPage";
import { mediaUrl, zipUrl } from "./story/PhotosCard";
import { parseStoryParams, storyPath, type StoryParams } from "./story-params";

const ID = "00000001-0000-4000-8000-000000000001";
const BASE = `/admin/forms/${ID}/submissions/ST-0001`;
const P1 = "00000003-0000-4000-8000-000000000001";
const P2 = "00000003-0000-4000-8000-000000000002";
const S1 = "00000003-0000-4000-8000-000000000003";

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

function context(postPlan: boolean, laterPhotosAllowed = postPlan): FormContext {
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
  return { form, versions: [version(1)], postPlan, laterPhotosAllowed };
}

function photo(mediaId: string, over: Partial<PhotoView> = {}): PhotoView {
  return {
    mediaId,
    kind: "image",
    status: "stored",
    durableKey: "forms/story-form/ST-0001/01-photos.jpg",
    chosen: false,
    origin: "sender",
    staff: null,
    ...over,
  };
}

const PHOTOS: PhotoView[] = [
  photo(P1),
  photo(P2, { durableKey: "forms/story-form/ST-0001/02-photos.jpg" }),
  photo(S1, {
    durableKey: "forms/story-form/ST-0001/added-0001.jpg",
    origin: "staff",
    staff: {
      addedBy: "owner@example.com",
      addedAt: new Date("2026-10-17T15:30:00Z"),
      source: "whatsapp",
    },
  }),
];

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
    photos: PHOTOS,
    checks: { chosen: [], photosEditedFor: null, textCheckedAt: null },
    readiness: {
      photosChosen: false,
      photosEdited: false,
      textChecked: false,
      ready: false,
      done: 0,
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

/** The form whose action is `action`, from its opening tag to its end. */
const formTo = (html: string, action: string) => between(html, `action="${action}"`, "</form>");
/** Every form whose action is `action`, each from its opening tag to its end. */
const formsTo = (html: string, action: string) =>
  html
    .split(`action="${action}"`)
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf("</form>")));

/** The text of the label for the control with id `id`. */
const labelOf = (html: string, id: string) => {
  const tag = between(html, `for="${id}"`, "</label>");
  return textOf(tag.slice(tag.indexOf(">") + 1));
};

/** The photos card, from its opening tag to the next card. */
const photosCard = (html: string) => between(html, 'id="photos"', "</section>");
/** The tile captioned `caption` ("Photo 1 of 3"), from its opening tag to its end. */
const tile = (html: string, caption: string) => {
  const at = html.indexOf(caption);
  const start = html.lastIndexOf("<li", at);
  return html.slice(start, html.indexOf("</li>", at) + 5);
};

describe("StoryPage photos", () => {
  it("shows the sender's photos, then the team's, each captioned in words", () => {
    const html = render(storyView());
    const card = photosCard(html);
    expect(tags(html, "section", 'id="photos"')).toHaveLength(1);
    expect(textOf(card)).toContain("Photos and videos Fotos y videos");
    expect(textOf(card)).toContain("Sent with the form Enviadas con el formulario");
    expect(textOf(card)).toContain("Added by the team Agregadas por el equipo");
    expect(card.indexOf("Sent with the form")).toBeLessThan(card.indexOf("Added by the team"));
    for (const [n, id] of [P1, P2, S1].entries()) {
      const caption = `Photo ${String(n + 1)} of 3`;
      expect(card).toContain(caption);
      const img = tags(card, "img", `src="${mediaUrl(ID, "ST-0001", id, "thumb")}"`);
      expect(img).toHaveLength(1);
      // The caption below the thumbnail says it, so the image adds nothing to read out.
      expect(attr(img[0] ?? "", "alt")).toBe("");
      expect(img[0]).toContain('loading="lazy"');
      expect(img[0]).toContain('width="160"');
      expect(img[0]).toContain('height="160"');
    }
    expect(card.indexOf("Photo 2 of 3")).toBeLessThan(card.indexOf("Added by the team"));
    expect(card.indexOf("Added by the team")).toBeLessThan(card.indexOf("Photo 3 of 3"));
    const staff = textOf(tile(card, "Photo 3 of 3"));
    expect(staff).toContain("Added by owner@example.com on 2026-10-17 10:30 America/Panama");
    expect(staff).toContain("From WhatsApp Desde WhatsApp");
    // File names stay out of the page; the viewer alone names the Dropbox path.
    expect(html).not.toContain("photos.jpg");
    expect(html).not.toContain("added-0001.jpg");
  });

  it("shows a video as a captioned tile without an image", () => {
    const html = render(
      storyView({ photos: [photo(P1), photo(P2, { kind: "video" }), PHOTOS[2] as PhotoView] }),
    );
    const video = tile(photosCard(html), "Video 2 of 3");
    expect(textOf(video)).toContain("Video 2 of 3 Video 2 de 3");
    expect(tags(video, "img")).toHaveLength(0);
    expect(tags(html, "img", `src="${mediaUrl(ID, "ST-0001", P2, "thumb")}"`)).toHaveLength(0);
  });

  it("offers View full size and Download per file, and the ZIPs", () => {
    const chosen = PHOTOS.map((p) => (p.mediaId === P2 ? { ...p, chosen: true } : p));
    const html = render(storyView({ photos: chosen }));
    const card = photosCard(html);
    for (const id of [P1, P2, S1]) {
      const full = storyPath(ID, "ST-0001", EMPTY_QUERY, { photo: id });
      expect(tags(card, "a", `href="${amp(full)}"`)).toHaveLength(1);
      const download = mediaUrl(ID, "ST-0001", id, "download");
      expect(tags(card, "a", `href="${amp(download)}"`)).toHaveLength(1);
    }
    expect(textOf(card).match(/View full size Ver en tamaño completo/g)).toHaveLength(3);
    const all = tags(card, "a", `href="${amp(zipUrl(ID, "ST-0001", "all"))}"`);
    expect(all).toHaveLength(1);
    expect(textOf(card)).toContain("Download all (3) Descargar todas (3)");
    expect(tags(card, "a", `href="${amp(zipUrl(ID, "ST-0001", "chosen"))}"`)).toHaveLength(1);
    expect(textOf(card)).toContain("Download chosen (1) Descargar elegidas (1)");

    const none = photosCard(render(storyView()));
    expect(none).not.toContain("Download chosen");
    expect(tags(none, "a", `href="${amp(zipUrl(ID, "ST-0001", "chosen"))}"`)).toHaveLength(0);

    const outside = photosCard(render(storyView({ ctx: context(false), photos: chosen })));
    expect(outside).toContain("Download all (3)");
    expect(outside).not.toContain("Download chosen");
  });

  it("toggles the choice with a button that says its state", () => {
    const chosen = PHOTOS.map((p) => (p.mediaId === P2 ? { ...p, chosen: true } : p));
    const html = render(storyView({ photos: chosen }));
    const card = photosCard(html);
    const forms = formsTo(card, `${BASE}/choice`);
    expect(forms).toHaveLength(3);

    const first = tile(card, "Photo 1 of 3");
    const choose = formTo(first, `${BASE}/choice`);
    expect(tags(choose, "input", 'name="media"', `value="${P1}"`)).toHaveLength(1);
    expect(tags(choose, "input", 'name="chosen"', 'value="1"')).toHaveLength(1);
    expect(tags(choose, "input", 'name="csrf"', 'value="csrf-token"')).toHaveLength(1);
    expect(textOf(choose)).toContain("Choose for the post Elegir para la publicación");
    expect(choose).toMatch(/<button\b[^>]*type="submit"/);
    expect(first).not.toContain("Chosen for the post");

    const second = tile(card, "Photo 2 of 3");
    expect(textOf(second)).toContain("Chosen for the post Elegida para la publicación");
    // The words come with a check icon, so the border is never the only signal.
    expect(between(second, "<svg", "</svg>")).toContain('aria-hidden="true"');
    const remove = formTo(second, `${BASE}/choice`);
    expect(tags(remove, "input", 'name="media"', `value="${P2}"`)).toHaveLength(1);
    expect(tags(remove, "input", 'name="chosen"', 'value="0"')).toHaveLength(1);
    expect(textOf(remove)).toContain("Remove from the post Quitar de la publicación");

    const outside = render(storyView({ ctx: context(false), photos: chosen }));
    expect(formsTo(outside, `${BASE}/choice`)).toHaveLength(0);
    expect(outside).not.toContain("Choose for the post");
    expect(outside).not.toContain("Chosen for the post");
    expect(outside).not.toContain("Remove from the post");
  });

  it("warns about a file kept only on the server", () => {
    const html = render(storyView({ photos: [photo(P1, { status: "failed" }), photo(P2)] }));
    const card = photosCard(html);
    expect(textOf(tile(card, "Photo 1 of 2"))).toContain(
      "Not in Dropbox yet: kept on the server only.",
    );
    expect(tile(card, "Photo 2 of 2")).not.toContain("Not in Dropbox yet");
  });

  it("offers removal for staff photos only, with a confirmation", () => {
    const html = render(storyView());
    const card = photosCard(html);
    const remove = storyPath(ID, "ST-0001", EMPTY_QUERY, { action: "remove_photo", media: S1 });
    expect(remove).toBe(`${BASE}?action=remove_photo&media=${S1}`);
    expect(tags(tile(card, "Photo 3 of 3"), "a", `href="${amp(remove)}"`)).toHaveLength(1);
    expect(textOf(tile(card, "Photo 3 of 3"))).toContain("Remove this photo Quitar esta foto");
    expect(tile(card, "Photo 1 of 3")).not.toContain("Remove this photo");
    expect(tile(card, "Photo 2 of 3")).not.toContain("Remove this photo");
    expect(dialog(html)).toBe("");

    const open = render(storyView(), { action: "remove_photo", media: S1 });
    const confirm = dialog(open);
    expect(textOf(confirm)).toContain(
      "Remove this photo from the story? Its file in Dropbox is deleted too.",
    );
    const form = formTo(confirm, `${BASE}/photos/remove`);
    expect(tags(form, "input", 'name="media"', `value="${S1}"`)).toHaveLength(1);
    expect(tags(form, "input", 'name="csrf"', 'value="csrf-token"')).toHaveLength(1);
    expect(form).toMatch(/<button\b[^>]*type="submit"/);
    expect(tags(confirm, "a", `href="${BASE}"`)).toHaveLength(1);
    // A sender's photo cannot be removed, even by a crafted link.
    expect(dialog(render(storyView(), { action: "remove_photo", media: P1 }))).toBe("");
  });

  it("keeps a team photo and its Remove link on a form with the post plan off", () => {
    const marked = PHOTOS.map((p) => (p.mediaId === P2 ? { ...p, chosen: true } : p));
    const html = render(storyView({ ctx: context(false), photos: marked }));
    const card = photosCard(html);
    expect(html).not.toContain("Chosen for the post");
    const staff = tile(card, "Photo 3 of 3");
    const remove = storyPath(ID, "ST-0001", EMPTY_QUERY, { action: "remove_photo", media: S1 });
    expect(tags(staff, "a", `href="${amp(remove)}"`)).toHaveLength(1);
    expect(textOf(staff)).toContain("Remove this photo Quitar esta foto");
    expect(textOf(staff)).toContain("Added by owner@example.com");
    expect(tile(card, "Photo 1 of 3")).not.toContain("Remove this photo");
    // Choosing, Add photos and the chosen state are post-plan parts and stay hidden.
    expect(formsTo(html, `${BASE}/choice`)).toHaveLength(0);
    expect(formTo(html, `${BASE}/photos`)).toBe("");
    // The link opens its confirmation, which posts to the remove route.
    const open = dialog(
      render(storyView({ ctx: context(false), photos: PHOTOS }), {
        action: "remove_photo",
        media: S1,
      }),
    );
    expect(tags(formTo(open, `${BASE}/photos/remove`), "input", `value="${S1}"`)).toHaveLength(1);
  });

  it("shows the viewer section for one photo", () => {
    const html = render(storyView(), { photo: P2 });
    const viewer = between(html, "<section", "</section>");
    expect(tags(viewer, "img", `src="${mediaUrl(ID, "ST-0001", P2, "full")}"`)).toHaveLength(1);
    expect(textOf(viewer)).toContain("Photo 2 of 3 Foto 2 de 3");
    const at = (id: string) => amp(storyPath(ID, "ST-0001", EMPTY_QUERY, { photo: id }));
    expect(tags(viewer, "a", `href="${at(P1)}"`)).toHaveLength(1);
    expect(tags(viewer, "a", `href="${at(S1)}"`)).toHaveLength(1);
    expect(textOf(viewer)).toContain("Previous Anterior");
    expect(textOf(viewer)).toContain("Next Siguiente");
    const download = amp(mediaUrl(ID, "ST-0001", P2, "download"));
    expect(tags(viewer, "a", `href="${download}"`)).toHaveLength(1);
    expect(textOf(viewer)).toContain("In Dropbox: forms/story-form/ST-0001/02-photos.jpg");
    expect(textOf(viewer)).toContain("Views and downloads are recorded");
    expect(tags(viewer, "a", `href="${BASE}"`)).toHaveLength(1);
    expect(textOf(viewer)).toContain("Back to the story Volver a la historia");
    expect(html.indexOf("Views and downloads")).toBeLessThan(html.indexOf('id="photos"'));

    const first = between(render(storyView(), { photo: P1 }), "<section", "</section>");
    expect(first).not.toContain("Previous");
    const last = between(render(storyView(), { photo: S1 }), "<section", "</section>");
    expect(last).not.toContain("Next");

    const videos = [photo(P1), photo(P2, { kind: "video" })];
    const video = between(
      render(storyView({ photos: videos }), { photo: P2 }),
      "<section",
      "</section>",
    );
    const player = tags(video, "video", "controls", 'preload="none"');
    expect(player).toHaveLength(1);
    expect(attr(player[0] ?? "", "src")).toBe(mediaUrl(ID, "ST-0001", P2, "full"));
    // The player is named by the caption heading above it.
    const captionId = attr(player[0] ?? "", "aria-labelledby") ?? "";
    expect(captionId).not.toBe("");
    expect(textOf(between(video, `id="${captionId}"`, "</h2>"))).toContain("Video 2 of 2");
    expect(video).not.toContain("autoplay");
    expect(video).not.toMatch(/autoPlay/i);
    expect(textOf(video)).toContain("Video 2 of 2 Video 2 de 2");
    expect(tags(video, "img")).toHaveLength(0);

    expect(render(storyView(), { photo: "not-a-photo" })).not.toContain("Views and downloads");
  });

  it("offers Add photos with a labelled, accessible form", () => {
    const html = render(storyView());
    const upload = formTo(html, `${BASE}/photos`);
    expect(upload).not.toBe("");
    const open = tags(html, "form", `action="${BASE}/photos"`)[0] ?? "";
    expect(open).toContain('method="post"');
    // React writes the attribute as `encType`; HTML attribute names are case-insensitive.
    expect(open.toLowerCase()).toContain('enctype="multipart/form-data"');
    expect(textOf(html)).toContain("Add photos Agregar fotos");
    const files = tags(upload, "input", 'type="file"', 'name="files"', "multiple");
    expect(files).toHaveLength(1);
    expect(attr(files[0] ?? "", "accept")).toBe(
      "image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime",
    );
    const filesId = attr(files[0] ?? "", "id") ?? "";
    expect(labelOf(upload, filesId)).toBe("Files Archivos");
    const hintId = (attr(files[0] ?? "", "aria-describedby") ?? "").split(" ")[0] ?? "";
    expect(textOf(between(upload, `id="${hintId}"`, "</p>"))).toContain(
      "Up to 10 files of 10 MB each.",
    );
    const fieldset = between(upload, "<fieldset", "</fieldset>");
    expect(textOf(between(fieldset, "<legend", "</legend>"))).toBe(
      "Where they came from De dónde llegaron",
    );
    const radios = tags(fieldset, "input", 'type="radio"', 'name="source"');
    expect(radios.map((r) => attr(r, "value"))).toEqual([
      "whatsapp",
      "instagram",
      "email",
      "other",
    ]);
    for (const radio of radios) {
      const id = attr(radio, "id") ?? "";
      expect(fieldset).toContain(`for="${id}"`);
    }
    expect(textOf(fieldset)).toMatch(/WhatsApp.*Instagram.*Email Correo.*Other Otro/);
    const confirm = tags(upload, "input", 'type="checkbox"', 'name="confirmed"', "required");
    expect(confirm).toHaveLength(1);
    const confirmId = attr(confirm[0] ?? "", "id") ?? "";
    expect(labelOf(upload, confirmId)).toBe(
      "The sender sent these for this story La persona las envió para esta historia",
    );
    expect(tags(upload, "input", 'name="csrf"', 'value="csrf-token"')).toHaveLength(1);
    expect(textOf(upload)).toContain("Upload Subir");
    expect(html).not.toContain('aria-invalid="true"');

    /** The refusal's message sits under the control it names, linked and marked invalid. */
    const refusedAt = (
      error: StoryParams["error"],
      n: number | null,
      control: string,
      words: string,
    ) => {
      const refused = formTo(render(storyView(), { error, n }), `${BASE}/photos`);
      const [element = "", ...attrs] = control.split(" ");
      const tag = tags(refused, element, ...attrs)
        .filter((t) => t.includes("aria-invalid"))
        .at(0);
      expect(tag, `${String(error)} marks its control`).toBeDefined();
      expect(tag).toContain('aria-invalid="true"');
      const ids = (attr(tag ?? "", "aria-describedby") ?? "").split(" ");
      const message = ids
        .map((id) => textOf(between(refused, `id="${id}"`, "</p>")))
        .find((text) => text.includes(words));
      expect(message, `${String(error)} is described by its message`).toBeDefined();
    };
    refusedAt("not_confirmed", null, 'input type="checkbox"', "Tick the box to confirm");
    refusedAt("source_invalid", null, 'input type="radio"', "Choose where the photos came from.");
    refusedAt("no_files", null, 'input type="file"', "Choose at least one file.");
    refusedAt("too_many_files", 10, 'input type="file"', "Upload at most 10 files at a time.");
    refusedAt("staff_photos_max", 30, 'input type="file"', "the most added photos allowed (30)");
    refusedAt("file_too_large", 2, 'input type="file"', "File 2 is larger than 10 MB.");
    refusedAt("file_wrong_type", 3, 'input type="file"', "File 3 is not a JPEG");
    refusedAt("file_unreadable", 1, 'input type="file"', "File 1 could not be read.");

    expect(formTo(render(storyView({ ctx: context(false) })), `${BASE}/photos`)).toBe("");
  });

  it("explains why Add photos is off", () => {
    const html = render(storyView({ ctx: context(true, false) }));
    expect(textOf(photosCard(html))).toContain(
      "Adding photos is off until the form publishes a consent text that covers photos sent later.",
    );
    expect(formTo(html, `${BASE}/photos`)).toBe("");
    expect(tags(html, "input", 'type="file"')).toHaveLength(0);
  });
});
