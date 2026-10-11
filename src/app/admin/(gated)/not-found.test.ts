import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotFound, { metadata } from "./not-found";

describe("gated not-found page", () => {
  const html = renderToStaticMarkup(createElement(NotFound));

  it("links back to the forms list and has a single h1", () => {
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('href="/admin/forms"');
    expect(html).toContain("Back to forms");
    expect(html).toContain("Volver a los formularios");
  });

  it("is titled in both languages", () => {
    expect(metadata).toEqual({ title: "Form not found / Formulario no encontrado" });
  });
});
