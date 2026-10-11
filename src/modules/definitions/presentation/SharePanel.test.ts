import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ShareInfo } from "../application";
import { SharePanel, sharePaths } from "./SharePanel";

const ID = "00000001-0000-4000-8000-000000000001";
const URL_ = "https://forms.example.com/f/spring-stories";

function panel(info: Partial<ShareInfo> = {}): string {
  return renderToStaticMarkup(
    createElement(SharePanel, {
      formId: ID,
      info: { url: URL_, reachable: true, reason: null, ...info },
    }),
  );
}

/** The opening tags of every `element` carrying all of `attrs`, in any attribute order. */
const tags = (html: string, element: string, ...attrs: string[]) =>
  (html.match(new RegExp(`<${element}\\b[^>]*>`, "g")) ?? []).filter((tag) =>
    attrs.every((attr) => tag.includes(attr)),
  );

describe("sharePaths", () => {
  it("builds the QR download and preview paths of a form", () => {
    expect(sharePaths(ID)).toEqual({
      preview: `/admin/forms/${ID}/qr.svg`,
      pngSmall: `/admin/forms/${ID}/qr.png?size=1024`,
      pngLarge: `/admin/forms/${ID}/qr.png?size=2048`,
      svg: `/admin/forms/${ID}/qr.svg?download=1`,
    });
  });
});

describe("SharePanel", () => {
  it("is a section with its own heading", () => {
    const html = panel();
    expect(html).toMatch(/<section\b/);
    expect(html).toMatch(/<h2\b[^>]*>Share/);
  });

  it("shows the public link in a labelled read-only field", () => {
    const html = panel();
    const [input] = tags(html, "input", "readOnly", `value="${URL_}"`);
    expect(input).toBeDefined();
    const id = input?.match(/\bid="([^"]+)"/)?.[1];
    expect(id).toBeDefined();
    expect(html).toMatch(new RegExp(`<label[^>]*for="${id ?? ""}"[^>]*>Public link`));
  });

  it("previews the QR code as an image with a description that names the link", () => {
    const [img] = tags(panel(), "img", `src="/admin/forms/${ID}/qr.svg"`);
    expect(img).toBeDefined();
    expect(img).toContain(`alt="QR code / Código QR: ${URL_}"`);
  });

  it("offers the three downloads as download links", () => {
    const html = panel();
    for (const [href, label] of [
      [`/admin/forms/${ID}/qr.png?size=1024`, "PNG 1024 px"],
      [`/admin/forms/${ID}/qr.png?size=2048`, "PNG 2048 px"],
      [`/admin/forms/${ID}/qr.svg?download=1`, "SVG"],
    ] as const) {
      const [link] = tags(html, "a", `href="${href}"`);
      expect(link, href).toBeDefined();
      expect(link).toContain('download=""');
      expect(html).toContain(`${label}</a>`);
    }
    expect(tags(html, "a", "download")).toHaveLength(3);
  });

  it("leaves out the print sheet until it exists", () => {
    expect(panel()).not.toContain("Print sheet");
  });

  it("says the code and link stay the same when changes are published", () => {
    expect(panel()).toContain("The QR code and link stay the same when you publish changes.");
  });

  it("shows no warning for a reachable form", () => {
    expect(panel()).not.toContain("not reachable");
    expect(panel()).not.toContain('role="status"');
  });

  it.each([
    ["draft", "it has not been published", "todavía no se ha publicado"],
    ["closed", "it is closed", "está cerrado"],
    ["archived", "it is archived", "está archivado"],
    ["not_open_yet", "it is not open yet", "todavía no abre"],
    ["past_close", "its close date has passed", "su fecha de cierre ya pasó"],
  ] as const)("warns with the reason for %s in both languages", (reason, en, es) => {
    const html = panel({ reachable: false, reason });
    expect(html).toContain(`The form is not reachable right now: ${en}.`);
    expect(html).toContain(es);
    expect(tags(html, "div", 'role="status"')).toHaveLength(1);
  });

  it("keeps the link, the QR and the downloads when the form is not reachable", () => {
    const html = panel({ reachable: false, reason: "closed" });
    expect(tags(html, "input", `value="${URL_}"`)).toHaveLength(1);
    expect(tags(html, "a", "download")).toHaveLength(3);
  });
});
