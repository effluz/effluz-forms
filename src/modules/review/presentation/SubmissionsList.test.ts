import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { settingsSchema, type Form, type FormVersion } from "@/modules/definitions/application";
import type { Version } from "@/shared/domain/form-model";
import {
  EMPTY_QUERY,
  type FormContext,
  type ListQuery,
  type StoryList,
  type StoryListRow,
} from "../application";
import { SubmissionsList } from "./SubmissionsList";
import { storyHref } from "./list-view";

const ID = "00000001-0000-4000-8000-000000000001";
const PUBLIC_URL = "https://forms.example.com/f/stories";

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
    slug: "stories",
    title: { en: "Stories", es: "Historias" },
    languages: "bilingual",
    status: "published",
    settings: settingsSchema.parse({ referencePrefix: "HP", usePostPlan: postPlan }),
    currentVersionId: "version-2",
    currentVersionNumber: 2,
    archivedAt: null,
    createdAt: new Date("2026-10-01T12:00:00Z"),
    updatedAt: new Date("2026-10-01T12:00:00Z"),
  };
  return { form, versions: [version(1), version(2)], postPlan, laterPhotosAllowed: postPlan };
}

function row(over: Partial<StoryListRow> = {}): StoryListRow {
  return {
    reference: "HP-0042",
    receivedAt: new Date("2026-10-16T14:00:00Z"),
    status: "new",
    plannedOn: null,
    published: false,
    label: "Ana Example",
    mediaCount: 2,
    versionNumber: 1,
    locale: "es",
    deadJobs: false,
    readiness: null,
    ...over,
  };
}

function storyList(over: Partial<StoryList> & { postPlan?: boolean } = {}): StoryList {
  const { postPlan = false, ...rest } = over;
  const rows = rest.rows ?? [row()];
  return {
    ctx: context(postPlan),
    query: EMPTY_QUERY,
    rows,
    total: rows.length,
    pageCount: 1,
    counts: { new: 3, viewed: 1, edited: 0, published: 2 },
    ...rest,
  };
}

function render(
  list: StoryList,
  over: Partial<Parameters<typeof SubmissionsList>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(SubmissionsList, {
      list,
      publicUrl: PUBLIC_URL,
      csrfToken: "csrf-token",
      exportOpen: false,
      exportError: null,
      deleted: null,
      ...over,
    }),
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

const body = (html: string) => between(html, "<tbody", "</tbody>");
const dialog = (html: string) => between(html, '<section role="dialog"', "</section>");
const occurrences = (html: string, text: string) => html.split(text).length - 1;

describe("SubmissionsList", () => {
  it("shows each row with its columns and a link to the story", () => {
    const query: ListQuery = { ...EMPTY_QUERY, status: "new" };
    const html = render(
      storyList({
        query,
        rows: [
          row({ deadJobs: true }),
          row({ reference: "HP-0041", status: "edited", locale: "en" }),
        ],
      }),
    );
    const rows = body(html);
    expect(tags(rows, "a", `href="${storyHref(ID, "HP-0042", query)}"`)).toHaveLength(1);
    expect(tags(rows, "a", `href="${storyHref(ID, "HP-0041", query)}"`)).toHaveLength(1);
    expect(rows).toContain("HP-0042");
    expect(rows).toMatch(/>New<span lang="es"[^>]*>Nueva</);
    expect(rows).toMatch(/>Edited<span lang="es"[^>]*>Editada</);
    expect(rows).toContain("2026-10-16 09:00 America/Panama");
    expect(rows).toContain("2026-10-16 14:00 UTC");
    expect(rows).toContain("Ana Example");
    expect(rows).toContain("2 files");
    expect(rows).toContain("2 archivos");
    expect(rows).toContain(">v1<");
    // The language is spelled out in both languages, the Spanish line marked lang="es".
    expect(rows).toMatch(/>Spanish<span lang="es"[^>]*>Español</);
    expect(rows).toMatch(/>English<span lang="es"[^>]*>Inglés</);
    expect(occurrences(rows, "Needs attention")).toBe(1);
    expect(occurrences(rows, "Necesita atención")).toBe(1);
  });

  it("says when a row has no label, one file or a single zone", () => {
    const html = render(
      storyList({
        rows: [row({ label: null, mediaCount: 1, receivedAt: new Date("2026-10-16T14:00:00Z") })],
      }),
    );
    const rows = body(html);
    expect(rows).toContain("No answer");
    expect(rows).toContain("1 file");
    expect(rows).not.toContain("1 files");
  });

  it("shows Planned with the date in place of the status", () => {
    const planned = row({ plannedOn: "2026-10-21" });
    const onPlan = body(render(storyList({ postPlan: true, rows: [planned] })));
    expect(onPlan).toContain("Planned · 2026-10-21");
    expect(onPlan).toContain("Planificada · 2026-10-21");
    expect(onPlan).not.toContain(">New<");
    expect(onPlan).not.toContain("Nueva");
    const offPlan = body(render(storyList({ postPlan: false, rows: [planned] })));
    expect(offPlan).not.toContain("Planned ·");
    expect(offPlan).toMatch(/>New<span lang="es"[^>]*>Nueva</);
    const published = body(
      render(
        storyList({
          postPlan: true,
          rows: [row({ plannedOn: "2026-10-21", status: "published", published: true })],
        }),
      ),
    );
    expect(published).not.toContain("Planned ·");
    expect(published).toContain("Published");
  });

  it("marks the active chip by more than color", () => {
    const html = render(storyList({ query: { ...EMPTY_QUERY, status: "new", page: 2 } }));
    const current = tags(html, "a", 'aria-current="true"');
    expect(current).toHaveLength(1);
    const chips = between(html, current[0] ?? "", "</a>");
    expect(chips).toContain("✓");
    expect(chips).toContain("New");
    expect(chips).toContain(">3<");
    // The active chip's link clears the filter and goes back to page 1.
    expect(current[0]).toContain(`href="/admin/forms/${ID}"`);
    // Each other chip shows its count and filters from page 1.
    const viewed = tags(html, "a", `href="/admin/forms/${ID}?status=viewed"`);
    expect(viewed).toHaveLength(1);
    expect(html).toContain(">2<");
    expect(html).toContain(">1<");
    expect(html).toContain(">0<");
  });

  it("offers the post-plan chips only on post-plan forms", () => {
    const on = render(storyList({ postPlan: true, rows: [] }));
    for (const text of ["Planned", "Waiting for a date", "Not ready"]) expect(on).toContain(text);
    expect(tags(on, "a", `href="/admin/forms/${ID}?plan=planned"`)).toHaveLength(1);
    expect(tags(on, "a", `href="/admin/forms/${ID}?plan=waiting"`)).toHaveLength(1);
    expect(tags(on, "a", `href="/admin/forms/${ID}?plan=not_ready"`)).toHaveLength(1);
    const off = render(storyList({ postPlan: false, rows: [] }));
    for (const text of ["Planned", "Waiting for a date", "Not ready", "Plan de publicaciones"])
      expect(off).not.toContain(text);
    expect(off).not.toContain("plan=");
  });

  it("marks the active plan chip too", () => {
    const html = render(storyList({ postPlan: true, query: { ...EMPTY_QUERY, plan: "waiting" } }));
    const current = tags(html, "a", 'aria-current="true"');
    expect(current).toHaveLength(1);
    expect(current[0]).toContain(`href="/admin/forms/${ID}"`);
    expect(between(html, current[0] ?? "", "</a>")).toContain("Waiting for a date");
  });

  it("keeps the filters in a GET form", () => {
    const html = render(
      storyList({
        postPlan: true,
        query: {
          ...EMPTY_QUERY,
          status: "new",
          plan: "waiting",
          from: "2026-10-01",
          to: "2026-10-15",
          version: 2,
          media: true,
          q: "ana",
          page: 2,
        },
      }),
    );
    const forms = tags(html, "form", 'method="get"', `action="/admin/forms/${ID}"`);
    expect(forms).toHaveLength(1);
    const filter = between(html, forms[0] ?? "", "</form>");
    expect(tags(filter, "input", 'type="date"', 'name="from"', 'value="2026-10-01"')).toHaveLength(
      1,
    );
    expect(tags(filter, "input", 'type="date"', 'name="to"', 'value="2026-10-15"')).toHaveLength(1);
    expect(tags(filter, "select", 'name="version"')).toHaveLength(1);
    expect(filter).toContain("All versions");
    expect(tags(filter, "option", 'value=""')).toHaveLength(1);
    expect(tags(filter, "option", 'value="1"')).toHaveLength(1);
    expect(tags(filter, "option", 'value="2"', "selected")).toHaveLength(1);
    expect(filter).toMatch(/<option value="1"[^>]*>v1</);
    expect(filter).toMatch(/<option value="2"[^>]*>v2</);
    expect(
      tags(filter, "input", 'type="checkbox"', 'name="media"', 'value="1"', "checked"),
    ).toHaveLength(1);
    expect(tags(filter, "input", 'type="search"', 'name="q"', 'value="ana"')).toHaveLength(1);
    expect(filter).toContain("Search answers");
    expect(filter).toContain("Buscar en respuestas");
    expect(tags(filter, "input", 'type="hidden"', 'name="status"', 'value="new"')).toHaveLength(1);
    expect(tags(filter, "input", 'type="hidden"', 'name="plan"', 'value="waiting"')).toHaveLength(
      1,
    );
    expect(tags(filter, "input", 'name="page"')).toHaveLength(0);
    expect(tags(filter, "button", 'type="submit"')).toHaveLength(1);
    expect(filter).toContain("Filter");
    // Every control has a programmatic label.
    for (const control of tags(filter, "(?:input|select)", "id=").filter(
      (tag) => !tag.includes('type="hidden"'),
    )) {
      const id = /id="([^"]+)"/.exec(control)?.[1] ?? "";
      expect(filter).toContain(`for="${id}"`);
    }
  });

  it("leaves the hidden filters out when none is set", () => {
    const filter = between(render(storyList()), "<form", "</form>");
    expect(tags(filter, "input", 'type="hidden"')).toHaveLength(0);
  });

  it("pages by 50 with the total", () => {
    const html = render(
      storyList({ query: { ...EMPTY_QUERY, status: "new", page: 2 }, total: 101, pageCount: 3 }),
    );
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain("Página 2 de 3");
    expect(html).toContain("101 submissions");
    expect(html).toContain("101 respuestas");
    // The pager is the last navigation: Newer goes to page 1 (no page key), Older to page 3.
    const pager = html.slice(html.lastIndexOf("<nav"));
    const newer = tags(pager, "a", `href="/admin/forms/${ID}?status=new"`);
    expect(newer).toHaveLength(1);
    expect(between(pager, newer[0] ?? "", "</a>")).toContain("Newer");
    const older = tags(pager, "a", `href="/admin/forms/${ID}?status=new&amp;page=3"`);
    expect(older).toHaveLength(1);
    expect(between(pager, older[0] ?? "", "</a>")).toContain("Older");
  });

  it("has no Newer link on the first page and no Older link on the last", () => {
    const first = render(storyList({ total: 101, pageCount: 3 }));
    expect(first).not.toContain("Newer");
    expect(first).toContain("Older");
    const last = render(
      storyList({ query: { ...EMPTY_QUERY, page: 3 }, total: 101, pageCount: 3 }),
    );
    expect(last).toContain("Newer");
    expect(last).not.toContain("Older");
    expect(render(storyList())).not.toContain("Page 1 of 1");
  });

  it("uses the singular for one submission", () => {
    const html = render(storyList({ total: 1 }));
    expect(html).toContain("1 submission<");
    expect(html).toContain("1 respuesta<");
    expect(html).not.toContain("1 submissions");
  });

  it("says when there is nothing yet, and when nothing matches", () => {
    const none = render(storyList({ rows: [], total: 0 }));
    expect(none).toContain("No submissions yet. Share the form to start receiving them.");
    expect(none).toContain(PUBLIC_URL);
    // The public URL opens in the same tab.
    expect(tags(none, "a", `href="${PUBLIC_URL}"`)[0]).not.toContain("target=");
    expect(none).not.toContain("<table");
    const filtered = render(
      storyList({ rows: [], total: 0, query: { ...EMPTY_QUERY, status: "viewed" } }),
    );
    expect(filtered).toContain("No submissions match these filters.");
    expect(filtered).not.toContain("No submissions yet");
    const clear = tags(filtered, "a", `href="/admin/forms/${ID}"`).filter(
      (tag) => !tag.includes("aria-current"),
    );
    expect(clear).toHaveLength(1);
    expect(filtered).toContain("Clear filters");
    expect(filtered).not.toContain("<table");
  });

  it("closes the dialog when it is not open and opens it with the Export link", () => {
    const html = render(storyList({ query: { ...EMPTY_QUERY, status: "new" } }));
    expect(html).not.toContain('role="dialog"');
    expect(
      tags(html, "a", `href="/admin/forms/${ID}?status=new&amp;export=1#export"`),
    ).toHaveLength(1);
  });

  it("opens the export dialog with the scope, options and notice", () => {
    const query: ListQuery = {
      ...EMPTY_QUERY,
      status: "new",
      plan: "planned",
      from: "2026-10-01",
      to: "2026-10-15",
      version: 2,
      media: true,
      q: "ana",
      page: 2,
    };
    const html = render(storyList({ postPlan: true, query, total: 101, pageCount: 3 }), {
      exportOpen: true,
    });
    const section = dialog(html);
    expect(section).not.toBe("");
    // The Export link lands on the dialog, which takes focus there.
    const open = tags(section, "section")[0] ?? "";
    expect(open).toContain('id="export"');
    expect(open).toContain('tabindex="-1"');
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(section)?.[1] ?? "";
    expect(labelledBy).not.toBe("");
    expect(between(section, `<h2 id="${labelledBy}"`, "</h2>")).toContain("Export submissions");
    expect(section).toContain("101 submissions matching the current filters");
    expect(section).toContain("101 respuestas que coinciden con los filtros actuales");
    for (const value of ["filter", "all"])
      expect(
        tags(section, "input", 'type="radio"', 'name="versions"', `value="${value}"`),
      ).toHaveLength(1);
    for (const value of ["original", "corrected", "both"])
      expect(
        tags(section, "input", 'type="radio"', 'name="text"', `value="${value}"`),
      ).toHaveLength(1);
    expect(tags(section, "input", 'type="radio"', "checked")).toHaveLength(2);
    expect(tags(section, "input", 'type="checkbox"', 'name="paths"', 'value="1"')).toHaveLength(1);
    expect(section).toContain("Include file paths");
    expect(section).toContain(
      "This file contains personal data. It is recorded that you exported it.",
    );
    expect(tags(section, "button", 'type="submit"')).toHaveLength(1);
    expect(section).toContain("Download CSV");
    expect(
      tags(section, "input", 'type="hidden"', 'name="csrf"', 'value="csrf-token"'),
    ).toHaveLength(1);
    const hidden: Record<string, string> = {
      status: "new",
      plan: "planned",
      from: "2026-10-01",
      to: "2026-10-15",
      version: "2",
      media: "1",
      q: "ana",
    };
    for (const [name, value] of Object.entries(hidden))
      expect(
        tags(section, "input", 'type="hidden"', `name="${name}"`, `value="${value}"`),
      ).toHaveLength(1);
    expect(tags(section, "input", 'name="page"')).toHaveLength(0);
    const form = tags(section, "form", `action="/admin/forms/${ID}/export"`, 'method="post"');
    expect(form).toHaveLength(1);
    // Cancel returns to the list with the same filters.
    expect(
      tags(
        section,
        "a",
        `href="/admin/forms/${ID}?status=new&amp;plan=planned&amp;from=2026-10-01&amp;to=2026-10-15&amp;version=2&amp;media=1&amp;q=ana&amp;page=2"`,
      ),
    ).toHaveLength(1);
  });

  it("refuses above 10,000 rows in the dialog", () => {
    const over = dialog(render(storyList({ total: 10_001 }), { exportOpen: true }));
    expect(over).toContain("More than 10,000 rows. Narrow the filters.");
    expect(over).toContain("Más de 10,000 filas. Reduce los filtros.");
    expect(over).not.toContain("Download CSV");
    expect(tags(over, "button")).toHaveLength(0);
    const exactly = dialog(render(storyList({ total: 10_000 }), { exportOpen: true }));
    expect(exactly).toContain("Download CSV");
    expect(exactly).not.toContain("More than 10,000 rows");
    const refused = dialog(
      render(storyList({ total: 5 }), { exportOpen: true, exportError: "too_large" }),
    );
    expect(refused).toContain("More than 10,000 rows. Narrow the filters.");
    expect(refused).not.toContain("Download CSV");
    expect(
      tags(refused, "p", 'role="alert"').length + tags(refused, "div", 'role="alert"').length,
    ).toBe(1);
  });

  it("reports a deletion", () => {
    const html = render(storyList(), { deleted: "HP-0042" });
    const banner = tags(html, "div", 'role="status"');
    expect(banner).toHaveLength(1);
    expect(between(html, banner[0] ?? "", "</div>")).toContain("Submission HP-0042 was deleted.");
    expect(html).toContain("Se eliminó la respuesta HP-0042.");
    expect(render(storyList())).not.toContain('role="status"');
  });

  it("escapes staff-authored and query text", () => {
    const html = render(
      storyList({
        query: { ...EMPTY_QUERY, q: '"><script>x</script>' },
        rows: [row({ label: "<b>Ana</b>" })],
      }),
      { deleted: "<i>HP</i>" },
    );
    expect(html).not.toContain("<script>x");
    expect(html).not.toContain("<b>Ana");
    expect(html).not.toContain("<i>HP");
    expect(html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
  });

  it("names the table", () => {
    const html = render(storyList());
    const caption = between(html, "<caption>", "</caption>");
    expect(caption).toContain("Submissions, newest first");
    expect(caption).toContain("Respuestas, de la más reciente a la más antigua");
    for (const header of [
      "Reference",
      "Status",
      "Received",
      "Name",
      "Files",
      "Version",
      "Language",
    ])
      expect(between(html, "<thead>", "</thead>")).toContain(header);
    expect(tags(html, "th", 'scope="col"')).toHaveLength(7);
  });
});
