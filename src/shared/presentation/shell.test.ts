import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { Banner } from "./Banner";
import { Bilingual } from "./Bilingual";
import { Breadcrumbs } from "./Breadcrumbs";
import { ConfirmForm } from "./ConfirmForm";
import { ManagerShell } from "./ManagerShell";
import { adminMetadata, pageMetadata } from "./metadata";
import { Table } from "./Table";
import { Tabs } from "./Tabs";

const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;
/** The opening tag of every element matching `re`. */
const tags = (html: string, re: RegExp) => html.match(re) ?? [];

describe("Bilingual", () => {
  it("shows English with the Spanish line marked lang=es", () => {
    const html = renderToStaticMarkup(createElement(Bilingual, { k: "nav.forms" }));
    expect(html).toMatch(/^Forms<span lang="es"[^>]*>Formularios<\/span>$/);
  });

  it("fills placeholders as text, escaping markup", () => {
    const html = renderToStaticMarkup(
      createElement(Bilingual, { k: "shell.signed_in_as", vars: { name: "Staff <Member>" } }),
    );
    expect(html).toContain("Signed in as Staff &lt;Member&gt;");
    expect(html).toContain("Sesión iniciada como Staff &lt;Member&gt;");
  });

  it("shows identical text once", () => {
    expect(renderToStaticMarkup(createElement(Bilingual, { k: "shell.wordmark" }))).toBe("Effluz");
  });
});

describe("metadata", () => {
  it("keeps admin pages out of search indexes", () => {
    expect(adminMetadata).toEqual({ robots: { index: false, follow: false } });
  });

  it("titles a page in both languages from a copy key or a text", () => {
    expect(pageMetadata("nav.forms")).toEqual({ title: "Forms / Formularios" });
    expect(pageMetadata({ en: "Hello", es: "Hola" })).toEqual({ title: "Hello / Hola" });
  });
});

describe("ManagerShell", () => {
  const render = (current: "forms" | "operations" | "audit") =>
    renderToStaticMarkup(
      createElement(ManagerShell, {
        name: "Staff <Member>",
        csrfToken: "csrf-1",
        current,
        children: createElement("h1", null, "Page heading"),
      }),
    );
  const html = render("forms");

  it("has one header, one main navigation and one main landmark around the page", () => {
    expect(count(html, /<header\b/g)).toBe(1);
    expect(count(html, /<nav\b/g)).toBe(1);
    expect(html).toMatch(/<nav [^>]*aria-label="Main navigation \/ Navegación principal"/);
    expect(count(html, /<main\b/g)).toBe(1);
    expect(html).toMatch(/<main [^>]*id="main"[^>]*><h1>Page heading<\/h1><\/main>/);
  });

  it("starts with a skip link to the main content", () => {
    expect(html).toMatch(/^<div[^>]*><a [^>]*href="#main"[^>]*>Skip to main content<span/);
  });

  it("links the wordmark to the forms list", () => {
    expect(html).toMatch(/<a [^>]*href="\/admin\/forms"[^>]*>Effluz<\/a>/);
  });

  it("links Forms and marks the current section; Operations and Audit are disabled until they exist", () => {
    const forms = tags(html, /<a [^>]*>Forms<span/g);
    expect(forms.length).toBeGreaterThan(0);
    for (const tag of forms) {
      expect(tag).toContain('href="/admin/forms"');
      expect(tag).toContain('aria-current="page"');
    }
    for (const label of ["Operations", "Audit"]) {
      const links = tags(html, new RegExp(`<a [^>]*>${label}<span`, "g"));
      expect(links.length).toBeGreaterThan(0);
      for (const tag of links) {
        expect(tag).toContain('aria-disabled="true"');
        expect(tag).not.toContain("href=");
        expect(tag).not.toContain("aria-current");
      }
    }
    expect(count(html, /aria-current="page"/g)).toBe(forms.length);
  });

  it("collapses the navigation into a disclosure for narrow screens, without JavaScript", () => {
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Forms<span lang="es"/);
    expect(html).not.toContain("<script");
  });

  it("marks another section as current when asked", () => {
    const audit = render("audit");
    for (const tag of tags(audit, /<a [^>]*>Audit<span/g)) {
      expect(tag).toContain('aria-current="page"');
    }
    for (const tag of tags(audit, /<a [^>]*>Forms<span/g)) {
      expect(tag).not.toContain("aria-current");
    }
  });

  it("shows who is signed in, escaping the name", () => {
    expect(html).toContain("Signed in as Staff &lt;Member&gt;");
    expect(html).toContain("Sesión iniciada como Staff &lt;Member&gt;");
  });

  it("signs out through a plain POST form carrying the CSRF token", () => {
    const form = /<form [^>]*>/.exec(html)?.[0] ?? "";
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/admin/auth/signout"');
    expect(html).toContain('<input type="hidden" name="csrf" value="csrf-1"/>');
    expect(html).toMatch(
      /<button [^>]*type="submit"[^>]*>Sign out<span lang="es"[^>]*>Cerrar sesión/,
    );
  });
});

describe("Breadcrumbs", () => {
  const html = renderToStaticMarkup(
    createElement(Breadcrumbs, {
      items: [
        { label: "Forms", href: "/admin/forms" },
        { label: "Spring stories", href: "/admin/forms/f-1" },
        { label: "Settings" },
      ],
    }),
  );

  it("is a labelled navigation with an ordered list", () => {
    expect(html).toMatch(/^<nav [^>]*aria-label="Breadcrumb \/ Ruta de navegación"[^>]*><ol/);
    expect(count(html, /<li\b/g)).toBe(3);
  });

  it("links the ancestors and marks only the last item as the current page", () => {
    expect(html).toContain('href="/admin/forms"');
    expect(html).toContain('href="/admin/forms/f-1"');
    expect(count(html, /aria-current="page"/g)).toBe(1);
    expect(html).toMatch(/<span aria-current="page"[^>]*>Settings<\/span><\/li><\/ol><\/nav>$/);
  });

  it("marks a linked last item as current too", () => {
    const linked = renderToStaticMarkup(
      createElement(Breadcrumbs, { items: [{ label: "Forms", href: "/admin/forms" }] }),
    );
    expect(linked).toMatch(/<a [^>]*href="\/admin\/forms"[^>]*aria-current="page"/);
  });
});

describe("Tabs", () => {
  const html = renderToStaticMarkup(
    createElement(Tabs, {
      items: [
        { key: "active", label: "Active", href: "/admin/forms", count: 3, current: true },
        {
          key: "closed",
          label: "Closed",
          href: "/admin/forms?tab=closed",
          count: 0,
          current: false,
        },
        { key: "archived", label: "Archived", href: "/admin/forms?tab=archived", current: false },
      ],
    }),
  );

  it("renders each tab as a link, the current one with aria-current", () => {
    expect(count(html, /<a\b/g)).toBe(3);
    expect(html).toContain('href="/admin/forms?tab=closed"');
    expect(count(html, /aria-current="page"/g)).toBe(1);
    expect(html).toMatch(/<a [^>]*href="\/admin\/forms"[^>]*aria-current="page"[^>]*>Active/);
  });

  it("shows counts when given, zero included", () => {
    expect(html).toMatch(/Active<span[^>]*>3<\/span>/);
    expect(html).toMatch(/Closed<span[^>]*>0<\/span>/);
    expect(html).toMatch(/Archived<\/a>/);
  });

  it("renders a disabled tab as a link without a destination", () => {
    const disabled = renderToStaticMarkup(
      createElement(Tabs, {
        items: [{ key: "subs", label: "Submissions", href: "/x", current: false, disabled: true }],
      }),
    );
    expect(disabled).toMatch(/<a [^>]*aria-disabled="true"[^>]*>Submissions/);
    expect(disabled).not.toContain('href="/x"');
  });
});

describe("Table", () => {
  const html = renderToStaticMarkup(
    createElement(Table, {
      caption: "Forms",
      columns: [
        { key: "title", header: "Title" },
        { key: "total", header: "Total" },
      ],
      rows: [
        { key: "f-1", cells: ["Spring stories", "12"], href: "/admin/forms/f-1" },
        { key: "f-2", cells: ["Volunteer sign-up", "0"] },
      ],
    }),
  );

  it("has a caption and column headers scoped to their columns", () => {
    expect(html).toContain("<caption");
    expect(html).toMatch(/<caption[^>]*>Forms<\/caption>/);
    expect(count(html, /<th scope="col"/g)).toBe(2);
    expect(html).toMatch(/<th scope="col"[^>]*>Title<\/th>/);
  });

  it("renders one body row per row, linking the first cell when the row has a destination", () => {
    expect(count(html.split("<tbody")[1] ?? "", /<tr\b/g)).toBe(2);
    expect(html).toMatch(/<a [^>]*href="\/admin\/forms\/f-1"[^>]*>Spring stories<\/a>/);
    expect(count(html, /<a\b/g)).toBe(1);
  });
});

describe("Badge", () => {
  it("always carries its text, with the tone as a class", () => {
    const html = renderToStaticMarkup(
      createElement(Badge, { tone: "success", children: "Published v2" }),
    );
    expect(html).toMatch(/^<span class="[^"]+">Published v2<\/span>$/);
  });
});

describe("Banner", () => {
  it("states a problem with an optional action link", () => {
    const html = renderToStaticMarkup(
      createElement(Banner, {
        tone: "warning",
        children: "Background jobs are not running.",
        action: { label: "See Operations", href: "/admin/operations" },
      }),
    );
    expect(html).toMatch(/^<div [^>]*role="status"/);
    expect(html).toContain("Background jobs are not running.");
    expect(html).toMatch(/<a [^>]*href="\/admin\/operations"[^>]*>See Operations<\/a>/);
  });

  it("is an alert when it reports danger", () => {
    const html = renderToStaticMarkup(
      createElement(Banner, { tone: "danger", children: "Failed" }),
    );
    expect(html).toMatch(/^<div [^>]*role="alert"/);
    expect(html).not.toContain("<a");
  });
});

describe("ConfirmForm", () => {
  const html = renderToStaticMarkup(
    createElement(ConfirmForm, {
      action: "/admin/forms/f-1/delete",
      csrfToken: "csrf-1",
      hidden: { action: "delete", formId: "f-1" },
      title: "life.delete",
      body: "life.delete_body",
      confirmLabel: "life.delete",
      cancelHref: "/admin/forms/f-1",
      typeToConfirm: { name: "slug", expected: "spring.stories(2)", label: "new.slug" },
    }),
  );

  it("is a dialog labelled by its heading and described by its body", () => {
    const section = /<section [^>]*>/.exec(html)?.[0] ?? "";
    expect(section).toContain('role="dialog"');
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(section)?.[1];
    const describedBy = /aria-describedby="([^"]+)"/.exec(section)?.[1];
    expect(html).toMatch(new RegExp(`<h2 id="${labelledBy ?? "-"}"[^>]*>Delete form<span`));
    expect(html).toMatch(new RegExp(`<p id="${describedBy ?? "-"}"[^>]*>This form has never`));
  });

  it("posts a plain form with the CSRF token and every hidden field", () => {
    const form = /<form [^>]*>/.exec(html)?.[0] ?? "";
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/admin/forms/f-1/delete"');
    expect(html).toContain('<input type="hidden" name="csrf" value="csrf-1"/>');
    expect(html).toContain('<input type="hidden" name="action" value="delete"/>');
    expect(html).toContain('<input type="hidden" name="formId" value="f-1"/>');
    expect(html).not.toContain("<script");
  });

  it("asks to type the expected value, labelled, with a pattern that matches it literally", () => {
    const input = /<input [^>]*name="slug"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain("required");
    expect(input).toContain('pattern="spring\\.stories\\(2\\)"');
    const id = /id="([^"]+)"/.exec(input)?.[1];
    expect(html).toMatch(new RegExp(`<label [^>]*for="${id ?? "-"}"[^>]*>Link name<span`));
  });

  it("offers the confirm button and a cancel link back", () => {
    expect(html).toMatch(/<button [^>]*type="submit"[^>]*>Delete form<span/);
    expect(html).toMatch(
      /<a [^>]*href="\/admin\/forms\/f-1"[^>]*>Cancel<span lang="es"[^>]*>Cancelar/,
    );
  });

  it("has no typed confirmation unless asked", () => {
    const plain = renderToStaticMarkup(
      createElement(ConfirmForm, {
        action: "/admin/forms/f-1/lifecycle",
        csrfToken: "csrf-1",
        hidden: { action: "close" },
        title: "life.close",
        body: "life.close_body",
        confirmLabel: "life.close",
        cancelHref: "/admin/forms/f-1",
      }),
    );
    expect(count(plain, /<input\b/g)).toBe(2);
    expect(plain).not.toContain("pattern=");
  });
});
