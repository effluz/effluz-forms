/**
 * Copy bindings for the sign-in pages and the interim admin shell. The text is
 * owned by specs/ui-ux/manager.md, "Fixed chrome copy" ("Shell and home" and
 * "Sign-in and access"); `copy.test.ts` keeps this object equal to those rows.
 */
export const copy = {
  "nav.sign_out": { en: "Sign out", es: "Cerrar sesión" },
  "shell.wordmark": { en: "Effluz", es: "Effluz" },
  "shell.signed_in_as": { en: "Signed in as {name}", es: "Sesión iniciada como {name}" },
  "admin.home_placeholder": {
    en: "Admin area, coming soon",
    es: "Área de administración, próximamente",
  },
  "auth.denied_title": {
    en: "This account cannot access the admin area",
    es: "Esta cuenta no puede acceder al área de administración",
  },
  "auth.denied_body": {
    en: "Only accounts on the Effluz Workspace domain can sign in. Sign in with your Effluz work account.",
    es: "Solo pueden iniciar sesión las cuentas del dominio de Effluz en Workspace. Inicia sesión con tu cuenta de trabajo de Effluz.",
  },
  "auth.denied_retry": { en: "Try another account", es: "Probar con otra cuenta" },
  "auth.signed_out_title": { en: "You have signed out", es: "Has cerrado sesión" },
  "auth.signed_out_body": {
    en: "Your admin session has ended. You are still signed in to Google.",
    es: "Tu sesión de administración ha terminado. Tu sesión en Google sigue abierta.",
  },
  "auth.signed_out_again": { en: "Sign in again", es: "Volver a iniciar sesión" },
  "auth.error_title": {
    en: "Sign-in did not complete",
    es: "No se pudo completar el inicio de sesión",
  },
  "auth.error_body": {
    en: "Google may be unavailable, or the sign-in link expired. No session was created.",
    es: "Es posible que Google no esté disponible o que el enlace de inicio de sesión haya caducado. No se creó ninguna sesión.",
  },
  "auth.error_retry": { en: "Try again", es: "Intentar de nuevo" },
} as const satisfies Record<string, { en: string; es: string }>;

export type CopyKey = keyof typeof copy;

/** Replaces `{name}` placeholders. The result is rendered as text, never as markup. */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}
