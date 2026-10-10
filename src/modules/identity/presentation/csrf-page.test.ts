import { describe, expect, it } from "vitest";
import { csrfRejectedPage } from "./csrf-page";

describe("csrfRejectedPage", () => {
  const html = csrfRejectedPage();

  it("is a complete, unindexed English document with a title", () => {
    expect(html).toMatch(/^<!doctype html><html lang="en">/);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain(
      "<title>Sign-out did not go through / No se pudo cerrar la sesión</title>",
    );
  });

  it("has one main and one h1, with the Spanish line marked lang=es", () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(
      '<h1>Sign-out did not go through<span lang="es">No se pudo cerrar la sesión</span></h1>',
    );
  });

  it("links back to the admin area, which issues a fresh token", () => {
    expect(html).toMatch(
      /<a href="\/admin">Try again<span lang="es">Intentar de nuevo<\/span><\/a>/,
    );
  });

  it("has a visible focus style and a 44 px target", () => {
    expect(html).toContain("a:focus-visible{outline:2px solid #b75d69;outline-offset:2px}");
    expect(html).toContain("min-height:44px");
  });
});
