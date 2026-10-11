import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
