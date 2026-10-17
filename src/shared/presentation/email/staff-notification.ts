import { escapeHtml } from "../rich-text-html";
import type { EmailParts } from "./confirmation";
import { fillTemplate, staffParts } from "./copy";
import { BODY_STYLE, emailDocument } from "./layout";

/** Structural twin of notifications' `StaffNotificationData`. */
export interface StaffEmailData {
  formTitle: string;
  reference: string;
  receivedAt: string;
  link: string;
}

/**
 * The staff notification: English only, links to the form's manager page, carries no answers.
 * See specs/system/email.md, "Staff notification, fixed parts".
 */
export function renderStaffNotification(data: StaffEmailData): EmailParts {
  const vars = {
    "form title": data.formTitle,
    ref: data.reference,
    date: data.receivedAt,
    link: data.link,
  };
  const subject = fillTemplate(staffParts.Subject, vars)
    .replace(/[\r\n]+/g, " ")
    .trim();
  const preheader = fillTemplate(staffParts.Preheader, vars);
  const intro = fillTemplate(staffParts.Intro, vars);
  const reference = fillTemplate(staffParts.Reference, vars);
  const received = fillTemplate(staffParts.Received, vars);
  const linkLine = fillTemplate(staffParts.Link, vars);

  // The Link line is its label followed by the link itself; the label is the text before {link}.
  const label = fillTemplate(staffParts.Link.split("{link}")[0] ?? "", vars);
  const paragraph = (inner: string) =>
    `<p style="${escapeHtml(BODY_STYLE.paragraph)}">${inner}</p>`;
  const anchor = `<a href="${escapeHtml(data.link)}" style="${escapeHtml(BODY_STYLE.link)}">${escapeHtml(data.link)}</a>`;
  const bodyHtml = [
    paragraph(escapeHtml(intro)),
    paragraph(escapeHtml(reference)),
    paragraph(escapeHtml(received)),
    paragraph(`${escapeHtml(label)}${anchor}`),
  ].join("");

  const text = [intro, reference, received, linkLine, "", "--", staffParts.Footer].join("\n");
  const html = emailDocument({
    lang: "en",
    title: subject,
    preheader,
    bodyHtml,
    footer: [staffParts.Footer],
  });
  return { subject, text, html };
}
