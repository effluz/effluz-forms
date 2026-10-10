import { copy, type CopyKey } from "./copy";

/**
 * The page behind a sign-out refused for a wrong CSRF token, as one static HTML
 * document: a route handler response has no React tree or CSS module behind it.
 * Colors and sizes repeat the tokens used in `auth.module.css` (the card width
 * is `size.contentWidthPublic`).
 */

const STYLE = [
  "body{margin:0;background:#f4f3fa;color:#372549;font:15px/1.6 Poppins,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}",
  "main{box-sizing:border-box;max-width:640px;margin:64px auto 0;padding:32px;background:#fff;border:1px solid #eff0f5;border-radius:16px}",
  "h1{margin:0 0 16px;font-size:24px;font-weight:600;line-height:1.2}",
  "p{margin:0 0 24px}",
  "span{display:block;color:#774c60;font-weight:400}",
  "a{box-sizing:border-box;display:inline-flex;flex-direction:column;justify-content:center;min-height:44px;padding:4px 16px;border-radius:12px;background:#372549;color:#fff3ef;font-size:14px;font-weight:500;line-height:1.2;text-decoration:none}",
  "a span{color:inherit;font-size:13px;line-height:1.5}",
  "a:hover{background:#6c344e}",
  "a:focus-visible{outline:2px solid #b75d69;outline-offset:2px}",
].join("");

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** English with the Spanish line beneath, as in `Bilingual`. */
function bilingual(key: CopyKey): string {
  const { en, es } = copy[key];
  return `${escapeHtml(en)}<span lang="es">${escapeHtml(es)}</span>`;
}

export function csrfRejectedPage(): string {
  const title = copy["auth.csrf_title"];
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${escapeHtml(`${title.en} / ${title.es}`)}</title>`,
    `<style>${STYLE}</style></head><body><main>`,
    `<h1>${bilingual("auth.csrf_title")}</h1>`,
    `<p>${bilingual("auth.csrf_body")}</p>`,
    `<a href="/admin">${bilingual("auth.error_retry")}</a>`,
    "</main></body></html>",
  ].join("");
}
