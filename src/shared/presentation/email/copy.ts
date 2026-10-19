/**
 * Fixed parts of the three emails. The specs own the text and `copy.test.ts` keeps this file equal
 * to them: specs/ui-ux/renderer.md, "Confirmation email, fixed parts" (both languages) and
 * specs/system/email.md, "Staff notification, fixed parts" and "Job alert, fixed parts" (English only).
 */

export const confirmationParts = {
  Preheader: {
    en: "Your response to {form title} was received",
    es: "Recibimos tu respuesta a {form title}",
  },
  "Footer line 1": {
    en: 'You received this email because you submitted "{form title}" on {date}. Reference {ref}.',
    es: 'Recibes este correo porque enviaste "{form title}" el {date}. Referencia {ref}.',
  },
  "Footer line 2": {
    en: "Effluz stores your answers in the United States for {retention} months. To ask for earlier deletion, reply to this email or write to {contact}.",
    es: "Effluz guarda tus respuestas en Estados Unidos durante {retention} meses. Para pedir que se eliminen antes, responde a este correo o escribe a {contact}.",
  },
} as const;

export const staffParts = {
  Subject: "New submission to {form title}: {ref}",
  Preheader: "{form title} received submission {ref}",
  Intro: "{form title} received a new submission.",
  Reference: "Reference: {ref}",
  Received: "Received: {date}",
  Link: "Open it in the manager: {link}",
  Footer: "This email carries no answers or files. Sign in to the manager to see them.",
} as const;

export const alertParts = {
  Subject: "Jobs need attention: {job type} ({count})",
  Preheader: "{count} {job type} jobs stopped retrying",
  Intro: "{count} background jobs of type {job type} stopped retrying and need attention.",
  References: "Stories affected: {refs}",
  More: "and {n} more",
  Link: "Open Operations in the manager: {link}",
  Footer: "This email carries no answers or files. Sign in to the manager to see them.",
} as const;

/**
 * Replaces `{name}` placeholders (lowercase words, spaces allowed) with their values and leaves
 * unknown ones as they are. The result is text, never markup: escape it before putting it in HTML.
 * Values are inserted in one pass, so a value that looks like a placeholder is not filled again.
 */
export function fillTemplate(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(/\{([a-z][a-z ]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(vars, name) ? (vars[name] ?? placeholder) : placeholder,
  );
}
