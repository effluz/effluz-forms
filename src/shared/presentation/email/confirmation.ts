import { parseRichText, richTextToPlain } from "@/shared/domain/rich-text";
import { richTextToHtml } from "../rich-text-html";
import { confirmationParts, fillTemplate } from "./copy";
import { BODY_STYLE, emailDocument } from "./layout";

/** Structural twin of notifications' `SubmitterConfirmationData`; shared may not import modules. */
export interface ConfirmationEmailData {
  locale: "en" | "es";
  formTitle: string;
  subject: string;
  body: string;
  receivedOn: string;
  reference: string;
  retentionMonths: number;
  contact: string;
}

/** Structural twin of notifications' `RenderedEmail`. */
export interface EmailParts {
  subject: string;
  text: string;
  html: string;
}

/**
 * The submitter's confirmation in the form's language: staff-authored subject and body inside
 * the fixed parts. See specs/ui-ux/renderer.md, "Confirmation email, fixed parts", and
 * specs/system/email.md, "Templates".
 */
export function renderSubmitterConfirmation(data: ConfirmationEmailData): EmailParts {
  const { locale } = data;
  const vars = {
    "form title": data.formTitle,
    date: data.receivedOn,
    ref: data.reference,
    retention: String(data.retentionMonths),
    contact: data.contact,
  };
  const subject = data.subject.replace(/[\r\n]+/g, " ").trim();
  const preheader = fillTemplate(confirmationParts.Preheader[locale], vars);
  const footer = [
    fillTemplate(confirmationParts["Footer line 1"][locale], vars),
    fillTemplate(confirmationParts["Footer line 2"][locale], vars),
  ];
  const blocks = parseRichText(data.body);

  const text = [preheader, "", richTextToPlain(blocks), "", "--", ...footer].join("\n");
  const html = emailDocument({
    lang: locale,
    title: subject,
    preheader,
    bodyHtml: richTextToHtml(blocks, BODY_STYLE),
    footer,
  });
  return { subject, text, html };
}
