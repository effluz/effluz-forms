import { escapeHtml } from "../rich-text-html";
import type { EmailParts } from "./confirmation";
import { alertParts, fillTemplate } from "./copy";
import { BODY_STYLE, emailDocument } from "./layout";

/** Structural twin of notifications' `JobAlertData`. */
export interface JobAlertEmailData {
  jobType: string;
  count: number;
  references: string[];
  moreCount: number;
  link: string;
}

/**
 * The job alert: English only, names a job type and a count, lists story references and links to
 * Operations. It carries no story content. See specs/system/email.md, "Job alert, fixed parts".
 */
export function renderJobAlert(data: JobAlertEmailData): EmailParts {
  const vars = {
    "job type": data.jobType,
    count: String(data.count),
    n: String(data.moreCount),
    link: data.link,
  };
  const subject = fillTemplate(alertParts.Subject, vars)
    .replace(/[\r\n]+/g, " ")
    .trim();
  const preheader = fillTemplate(alertParts.Preheader, vars);
  const intro = fillTemplate(alertParts.Intro, vars);
  const linkLine = fillTemplate(alertParts.Link, vars);

  // The References line is left out when no story is affected; More follows the references.
  const more = data.moreCount > 0 ? ` ${fillTemplate(alertParts.More, vars)}` : "";
  const references =
    data.references.length > 0
      ? `${fillTemplate(alertParts.References, { ...vars, refs: data.references.join(", ") })}${more}`
      : null;

  // The Link line is its label followed by the link itself; the label is the text before {link}.
  const label = fillTemplate(alertParts.Link.split("{link}")[0] ?? "", vars);
  const paragraph = (inner: string) =>
    `<p style="${escapeHtml(BODY_STYLE.paragraph)}">${inner}</p>`;
  const anchor = `<a href="${escapeHtml(data.link)}" style="${escapeHtml(BODY_STYLE.link)}">${escapeHtml(data.link)}</a>`;
  const bodyHtml = [
    paragraph(escapeHtml(intro)),
    ...(references === null ? [] : [paragraph(escapeHtml(references))]),
    paragraph(`${escapeHtml(label)}${anchor}`),
  ].join("");

  const text = [
    intro,
    ...(references === null ? [] : [references]),
    linkLine,
    "",
    "--",
    alertParts.Footer,
  ].join("\n");
  const html = emailDocument({
    lang: "en",
    title: subject,
    preheader,
    bodyHtml,
    footer: [alertParts.Footer],
  });
  return { subject, text, html };
}
