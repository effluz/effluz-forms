import { escapeHtml } from "../rich-text-html";

// Colors and font are design-system tokens (design-system/tokens.json), written out because
// email clients cannot read CSS variables.
const TEXT = "#1A1423"; // color.text.default (brand.ink)
const LINK = "#372549"; // color.text.link (brand.plum)
const MUTED = "#774C60"; // color.text.muted
const PAGE = "#FFF3EF"; // color.surface.page.public
const CARD = "#FFFFFF"; // color.surface.card
const BORDER = "#EFF0F5"; // color.border.default
const FONT = "Poppins, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"; // font.family.sans

/** The token values above, exposed so a test can hold them to design-system/tokens.json. */
export const EMAIL_TOKENS = { TEXT, LINK, MUTED, PAGE, CARD, BORDER, FONT } as const;

/** Inline styles for rich-text blocks in the body. */
export const BODY_STYLE = {
  paragraph: `margin:0 0 16px;font:17px/1.6 ${FONT};color:${TEXT}`,
  link: `color:${LINK};text-decoration:underline`,
};

/**
 * The shared HTML document for both emails: table-based, inline-styled, no images. Every
 * argument except `bodyHtml` is escaped here. See specs/system/email.md, "Templates".
 */
export function emailDocument(input: {
  lang: "en" | "es";
  title: string;
  preheader: string;
  bodyHtml: string;
  footer: readonly string[];
}): string {
  const footerStyle = escapeHtml(`margin:0 0 8px;font:15px/1.5 ${FONT};color:${MUTED}`);
  const footer = input.footer
    .map((line) => `<p style="${footerStyle}">${escapeHtml(line)}</p>`)
    .join("");
  return [
    "<!doctype html>",
    `<html lang="${input.lang}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title>`,
    "</head>",
    `<body style="margin:0;padding:0;background:${PAGE}">`,
    `<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(input.preheader)}</span>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE}"><tr><td align="center" style="padding:24px 16px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:${CARD};border:1px solid ${BORDER};border-radius:12px"><tr><td style="padding:32px 24px">`,
    input.bodyHtml,
    `<div style="margin-top:24px;padding-top:16px;border-top:1px solid ${BORDER}">${footer}</div>`,
    "</td></tr></table>",
    "</td></tr></table>",
    "</body>",
    "</html>",
  ].join("\n");
}
