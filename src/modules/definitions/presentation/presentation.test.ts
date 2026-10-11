import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FormListRow } from "../application";
import { FormsList } from "./FormsList";
import { NewFormDialog } from "./NewFormDialog";
import { carriedValues, refusedCreateLocation, type NewFormValues } from "./new-form-values";
import { formatDate, formHref, statusTone, titleText } from "./view-models";

const ID_1 = "00000001-0000-4000-8000-000000000001";
const ID_2 = "00000002-0000-4000-8000-000000000002";

function row(overrides: Partial<FormListRow> = {}): FormListRow {
  return {
    id: ID_1,
    slug: "spring-stories",
    title: { en: "Spring stories", es: "Historias de primavera" },
    status: "published",
    versionNumber: 2,
    newCount: 3,
    total: 12,
    lastReceivedAt: new Date("2026-10-09T14:30:00Z"),
    closesAt: "2026-10-20T04:59:00Z",
    timezone: "America/Panama",
    ...overrides,
  };
}

const COUNTS = { active: 2, closed: 1, archived: 0 };

function list(props: Partial<Parameters<typeof FormsList>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(FormsList, {
      tab: "active",
      counts: COUNTS,
      rows: [
        row(),
        row({
          id: ID_2,
          slug: "draft-form",
          title: { en: "Draft form" },
          status: "draft",
          versionNumber: null,
          newCount: 0,
          total: 0,
          lastReceivedAt: null,
          closesAt: null,
        }),
      ],
      search: "",
      ...props,
    }),
  );
}

const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;
/** The opening tags of every `element` carrying all of `attrs`, in any attribute order. */
const tags = (html: string, element: string, ...attrs: string[]) =>
  (html.match(new RegExp(`<${element}\\b[^>]*>`, "g")) ?? []).filter((tag) =>
    attrs.every((attr) => tag.includes(attr)),
  );

describe("view models", () => {
  it("maps statuses to the badge tones of the design system", () => {
    expect(statusTone("draft")).toBe("neutral");
    expect(statusTone("published")).toBe("success");
    expect(statusTone("closed")).toBe("warning");
    expect(statusTone("archived")).toBe("neutral");
  });

  it("formats a date in the time zone, labelled with it, and in UTC", () => {
    expect(formatDate("2026-10-09T14:30:00Z", "America/Panama")).toEqual({
      local: "2026-10-09 09:30 America/Panama",
      utc: "2026-10-09 14:30 UTC",
    });
    expect(formatDate(new Date("2026-01-01T00:05:00Z"), "UTC")).toEqual({
      local: "2026-01-01 00:05 UTC",
      utc: "2026-01-01 00:05 UTC",
    });
  });

  it("builds the form's links", () => {
    expect(formHref(ID_1)).toBe(`/admin/forms/${ID_1}`);
    expect(formHref(ID_1, "settings")).toBe(`/admin/forms/${ID_1}/settings`);
    expect(formHref(ID_1, "edit")).toBe(`/admin/forms/${ID_1}/edit`);
  });

  it("names a form by its titles, falling back to the slug", () => {
    expect(titleText({ en: "Spring", es: "Primavera" }, "s")).toBe("Spring / Primavera");
    expect(titleText({ es: "Primavera" }, "s")).toBe("Primavera");
    expect(titleText({ en: " " }, "spring-stories")).toBe("spring-stories");
  });
});

describe("FormsList", () => {
  it("has the page heading and the New form button", () => {
    const html = list();
    expect(html).toMatch(/<h1[^>]*>Forms<span lang="es"[^>]*>Formularios<\/span><\/h1>/);
    expect(html).toMatch(/<a class="[^"]*" href="\/admin\/forms\/new">New form/);
  });

  it("renders the three tabs with their counts, the current one marked", () => {
    const html = list({ tab: "closed" });
    expect(html).toMatch(
      /href="\/admin\/forms">Active<span[^>]*>Activos<\/span><span[^>]*>2<\/span>/,
    );
    expect(html).toMatch(
      /href="\/admin\/forms\?tab=closed" aria-current="page">Closed<span[^>]*>Cerrados<\/span><span[^>]*>1<\/span>/,
    );
    expect(html).toMatch(
      /href="\/admin\/forms\?tab=archived">Archived<span[^>]*>Archivados<\/span><span[^>]*>0<\/span>/,
    );
  });

  it("has a GET search form that keeps the tab and the query", () => {
    const html = list({ tab: "closed", search: "spring" });
    expect(
      tags(html, "form", 'role="search"', 'method="get"', 'action="/admin/forms"'),
    ).toHaveLength(1);
    expect(tags(html, "input", 'type="hidden"', 'name="tab"', 'value="closed"')).toHaveLength(1);
    const [search] = tags(html, "input", 'type="search"', 'name="q"', 'value="spring"');
    const id = search?.match(/ id="([^"]+)"/)?.[1];
    expect(html).toContain(`<label for="${id ?? "missing"}"`);
    expect(html).toMatch(/<label [^>]*>Search forms/);
  });

  it("leaves the tab out of the search on the Active tab", () => {
    expect(tags(list(), "input", 'name="tab"')).toHaveLength(0);
  });

  it("renders one row per form with the status badge and its version", () => {
    const html = list();
    expect(count(html, /<tr class="[^"]*">/g)).toBe(2);
    expect(html).toContain(`href="/admin/forms/${ID_1}"`);
    expect(html).toMatch(/Published v2<span lang="es"[^>]*>Publicado v2<\/span>/);
    expect(html).toMatch(/Draft<span lang="es"[^>]*>Borrador<\/span>/);
  });

  it("shows the version beside a closed form's badge", () => {
    const html = list({ tab: "closed", rows: [row({ status: "closed" })] });
    expect(html).toMatch(
      /Closed<span lang="es"[^>]*>Cerrado<\/span><\/span> ?<span[^>]*>v2<\/span>/,
    );
  });

  it("puts a new count above zero in bold, and zero in plain text", () => {
    const html = list();
    expect(html).toMatch(/<strong[^>]*>3<\/strong>/);
    expect(html).not.toMatch(/<strong[^>]*>0<\/strong>/);
  });

  it("shows each date in the form's zone and in UTC, both visible", () => {
    const html = list();
    const [last] = tags(html, "time", 'dateTime="2026-10-09T14:30:00.000Z"');
    expect(last).not.toContain("title=");
    expect(html).toMatch(
      /<time [^>]*>2026-10-09 09:30 America\/Panama<span class="[^"]*">2026-10-09 14:30 UTC<\/span><\/time>/,
    );
    expect(html).toMatch(
      /<time [^>]*>2026-10-19 23:59 America\/Panama<span class="[^"]*">2026-10-20 04:59 UTC<\/span><\/time>/,
    );
  });

  it("uses each form's own time zone", () => {
    const html = list({ rows: [row({ timezone: "Europe/Madrid", closesAt: null })] });
    expect(html).toContain("2026-10-09 16:30 Europe/Madrid");
  });

  it("shows UTC once for a form kept in UTC", () => {
    const html = list({ rows: [row({ timezone: "UTC", closesAt: null })] });
    expect(html).toMatch(/<time [^>]*>2026-10-09 14:30 UTC<\/time>/);
  });

  it("reads an empty date as None to assistive technology", () => {
    const html = list({ rows: [row({ lastReceivedAt: null, closesAt: null })] });
    expect(count(html, /<span aria-hidden="true">—<\/span>/g)).toBe(2);
    expect(
      count(html, /<span class="[^"]*">None<span lang="es"[^>]*>Ninguna<\/span><\/span>/g),
    ).toBe(2);
  });

  it("offers the overview links and only the allowed lifecycle actions in each row's menu", () => {
    const html = list({ rows: [row()] });
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Actions/);
    expect(html).toContain(`href="/admin/forms/${ID_1}/edit"`);
    expect(html).toContain(`href="/admin/forms/${ID_1}/share"`);
    expect(html).toContain(`href="/admin/forms/${ID_1}/settings"`);
    expect(html).toContain(`href="/admin/forms/${ID_1}?action=close"`);
    expect(html).toContain(`href="/admin/forms/${ID_1}?action=archive"`);
    expect(html).not.toContain("?action=reopen");
    expect(html).not.toContain("?action=unarchive");
  });

  it("names each actions menu after its form", () => {
    const html = list({ rows: [row()] });
    expect(html).toMatch(
      /Actions<span lang="es"[^>]*>Acciones<\/span><span class="[^"]*">Spring stories \/ Historias de primavera<\/span><\/summary>/,
    );
  });

  it("shows the empty state with the New form button on a new installation", () => {
    const html = list({ counts: { active: 0, closed: 0, archived: 0 }, rows: [] });
    expect(html).toContain("No forms yet. Create the first one.");
    expect(html).not.toContain("<table");
    expect(count(html, /href="\/admin\/forms\/new"/g)).toBe(1);
  });

  it("says so when a tab or a search has no forms, without the first-run sentence", () => {
    const html = list({ counts: { active: 2, closed: 0, archived: 0 }, tab: "closed", rows: [] });
    expect(html).toContain("No forms to show here.");
    expect(html).not.toContain("No forms yet.");
  });

  it("escapes staff-authored titles", () => {
    const html = list({ rows: [row({ title: { en: "<b>Spring</b>" } })] });
    expect(html).toContain("&lt;b&gt;Spring&lt;/b&gt;");
    expect(html).not.toContain("<b>Spring</b>");
  });
});

function dialog(props: Partial<Parameters<typeof NewFormDialog>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(NewFormDialog, {
      csrfToken: "csrf-token-1",
      sources: [
        {
          id: ID_1,
          title: { en: "Spring stories", es: "Historias de primavera" },
          slug: "spring-stories",
        },
      ],
      ...props,
    }),
  );
}

describe("NewFormDialog", () => {
  it("posts to the create route with the CSRF token", () => {
    const html = dialog();
    expect(tags(html, "form", 'method="post"', 'action="/admin/forms/create"')).toHaveLength(1);
    expect(html).toContain('<input type="hidden" name="csrf" value="csrf-token-1"/>');
    expect(html).toMatch(/<h1[^>]*>New form<span lang="es"/);
  });

  it("offers Blank, checked, and Duplicate with the forms to copy", () => {
    const html = dialog();
    expect(
      tags(html, "input", 'type="radio"', 'name="kind"', 'value="blank"', 'checked=""'),
    ).toHaveLength(1);
    const [duplicate] = tags(html, "input", 'type="radio"', 'name="kind"', 'value="duplicate"');
    expect(duplicate).not.toContain("checked");
    expect(tags(html, "select", 'name="source"')).toHaveLength(1);
    expect(html).toContain(
      `<option value="${ID_1}">Spring stories / Historias de primavera</option>`,
    );
  });

  it("leaves Duplicate out when there is no form to copy", () => {
    const html = dialog({ sources: [] });
    expect(html).not.toContain('value="duplicate"');
    expect(html).not.toContain("<select");
  });

  it("has a title input per language, marked with its lang", () => {
    const html = dialog();
    expect(tags(html, "input", 'name="title_en"', 'lang="en"')).toHaveLength(1);
    expect(tags(html, "input", 'name="title_es"', 'lang="es"')).toHaveLength(1);
    expect(html).toContain("Title in English");
    expect(html).toContain("Title in Spanish");
  });

  it("offers the three language modes, bilingual checked", () => {
    const html = dialog();
    expect(tags(html, "input", 'name="languages"', 'value="bilingual"', 'checked=""')).toHaveLength(
      1,
    );
    expect(tags(html, "input", 'name="languages"', 'value="en"')).toHaveLength(1);
    expect(tags(html, "input", 'name="languages"', 'value="es"')).toHaveLength(1);
    expect(tags(html, "input", 'name="languages"', "checked")).toHaveLength(1);
    expect(html).toContain("English only");
  });

  it("has an optional link name whose hints say the server fills it in", () => {
    const html = dialog();
    const [slug] = tags(html, "input", 'name="slug"');
    expect(slug).toBeDefined();
    expect(slug).not.toContain("required");
    expect(html).toContain("Letters, numbers and hyphens.");
    expect(html).toContain("Optional. Left empty, it is made from the title.");
  });

  it("renders no error row without an error", () => {
    expect(dialog()).not.toContain('role="alert"');
    expect(dialog()).not.toContain("aria-invalid");
  });

  it("shows slug_taken on the link name field and marks it invalid", () => {
    const html = dialog({ error: "slug_taken" });
    const alert = html.match(/<p id="([^"]+)" role="alert"[^>]*>That link name is taken/);
    expect(alert).not.toBeNull();
    const slugInput = tags(html, "input", 'name="slug"')[0] ?? "";
    expect(slugInput).toContain('aria-invalid="true"');
    expect(slugInput).toContain(alert?.[1] ?? "missing");
  });

  it("shows the field hint for the other codes", () => {
    expect(dialog({ error: "slug_format" })).toMatch(
      /role="alert"[^>]*>Letters, numbers and hyphens/,
    );
    expect(dialog({ error: "slug_reserved" })).toMatch(
      /role="alert"[^>]*>That link name is reserved/,
    );
    expect(dialog({ error: "title_missing" })).toMatch(
      /role="alert"[^>]*>Enter a title in each language/,
    );
    expect(dialog({ error: "source_not_found" })).toMatch(
      /role="alert"[^>]*>Choose a form to duplicate/,
    );
  });

  it("marks both title inputs invalid for title_missing", () => {
    const html = dialog({ error: "title_missing" });
    expect(tags(html, "input", 'name="title_e', 'aria-invalid="true"')).toHaveLength(2);
    expect(tags(html, "input", 'name="slug"', "aria-invalid")).toHaveLength(0);
  });

  it("has a Cancel link back to the list and a Create button", () => {
    const html = dialog();
    expect(html).toMatch(/<a class="[^"]*" href="\/admin\/forms">Cancel/);
    expect(html).toMatch(/<button[^>]*type="submit">Create/);
  });

  it("is a section labelled by its heading, not an ARIA dialog", () => {
    const html = dialog();
    expect(html).not.toContain('role="dialog"');
    const [section] = tags(html, "section", "aria-labelledby=");
    const id = section?.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(tags(html, "h1", `id="${id ?? "missing"}"`)).toHaveLength(1);
  });

  it("comes back filled in with the values carried after a refusal", () => {
    const html = dialog({
      error: "slug_taken",
      values: {
        kind: "duplicate",
        titleEn: "Spring stories",
        titleEs: "Historias de primavera",
        languages: "es",
        slug: "spring-stories",
        source: ID_2,
      },
      sources: [
        { id: ID_1, title: { en: "One" }, slug: "one" },
        { id: ID_2, title: { en: "Two" }, slug: "two" },
      ],
    });
    expect(tags(html, "input", 'name="kind"', 'value="duplicate"', "checked")).toHaveLength(1);
    expect(tags(html, "input", 'name="kind"', 'value="blank"', "checked")).toHaveLength(0);
    expect(tags(html, "input", 'name="title_en"', 'value="Spring stories"')).toHaveLength(1);
    expect(tags(html, "input", 'name="title_es"', 'value="Historias de primavera"')).toHaveLength(
      1,
    );
    expect(tags(html, "input", 'name="languages"', 'value="es"', "checked")).toHaveLength(1);
    expect(tags(html, "input", 'name="languages"', "checked")).toHaveLength(1);
    expect(tags(html, "input", 'name="slug"', 'value="spring-stories"')).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<option value="${ID_2}" selected="">Two</option>`));
  });

  it("falls back to Blank when the carried choice is Duplicate but nothing can be copied", () => {
    const html = dialog({ sources: [], values: { kind: "duplicate" } });
    expect(tags(html, "input", 'name="kind"', 'value="blank"', "checked")).toHaveLength(1);
  });
});

describe("carried values", () => {
  const typed: NewFormValues = {
    kind: "blank",
    titleEn: "Spring stories",
    titleEs: "Historias de primavera",
    languages: "bilingual",
    slug: "spring-stories",
    source: "",
  };

  it("round-trips the typed values through the refusal URL", () => {
    const location = refusedCreateLocation("slug_taken", typed);
    expect(location.startsWith("/admin/forms/new?error=slug_taken&")).toBe(true);
    const params = Object.fromEntries(new URL(location, "https://forms.example.com").searchParams);
    expect(carriedValues(params)).toEqual({
      kind: "blank",
      titleEn: "Spring stories",
      titleEs: "Historias de primavera",
      languages: "bilingual",
      slug: "spring-stories",
    });
  });

  it("leaves out values over their limit, in the URL and when reading it", () => {
    const long = "x".repeat(501);
    expect(refusedCreateLocation("title_missing", { ...typed, titleEn: long })).not.toContain(
      "title_en",
    );
    expect(carriedValues({ title_en: long, slug: "s".repeat(65), source: "x".repeat(37) })).toEqual(
      {},
    );
  });

  it("ignores a malformed choice or language mode", () => {
    expect(carriedValues({ kind: "other", languages: "fr" })).toEqual({});
  });
});
