import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminHomePlaceholder } from "./AdminHomePlaceholder";
import { AdminShell } from "./AdminShell";
import { DeniedPage } from "./DeniedPage";
import { SignedOutPage } from "./SignedOutPage";
import { SignInErrorPage } from "./SignInErrorPage";

const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

describe.each<[string, FunctionComponent, string, string]>([
  ["DeniedPage", DeniedPage, "This account cannot access the admin area", "Try another account"],
  ["SignedOutPage", SignedOutPage, "You have signed out", "Sign in again"],
  ["SignInErrorPage", SignInErrorPage, "Sign-in did not complete", "Try again"],
])("%s", (_name, Page, heading, action) => {
  const html = renderToStaticMarkup(createElement(Page));

  it("has one main landmark and one h1 with the English heading", () => {
    expect(count(html, /<main\b/g)).toBe(1);
    expect(count(html, /<h1\b/g)).toBe(1);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${heading}<span lang="es"`));
  });

  it("offers sign-in again as a link, with the Spanish text marked lang=es", () => {
    expect(html).toMatch(new RegExp(`<a [^>]*href="/admin/auth/signin"[^>]*>${action}<span`));
    expect(count(html, /lang="es"/g)).toBe(3);
  });
});

describe("AdminShell", () => {
  const html = renderToStaticMarkup(
    createElement(AdminShell, {
      name: "Staff <Member>",
      csrfToken: "csrf-1",
      children: createElement(AdminHomePlaceholder),
    }),
  );

  it("shows who is signed in, escaping the name", () => {
    expect(html).toContain("Signed in as Staff &lt;Member&gt;");
    expect(html).toContain('<span lang="es"');
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

  it("puts the page in its main landmark, with the page's single h1", () => {
    expect(count(html, /<header\b/g)).toBe(1);
    expect(count(html, /<main\b/g)).toBe(1);
    expect(count(html, /<h1\b/g)).toBe(1);
    expect(html).toMatch(/<main[^>]*><h1[^>]*>Admin area, coming soon/);
  });
});
