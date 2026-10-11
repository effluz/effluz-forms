import type { Text } from "@/shared/presentation/copy";

/**
 * Copy bindings for the sign-in pages. The text is owned by specs/ui-ux/manager.md,
 * "Fixed chrome copy" ("Sign-in and access"); `copy.test.ts` keeps this object equal
 * to those rows. The shell's copy, sign-out included, is in
 * src/shared/presentation/copy.ts.
 */
export const copy = {
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
  "auth.csrf_title": {
    en: "Sign-out did not go through",
    es: "No se pudo cerrar la sesión",
  },
  "auth.csrf_body": {
    en: "This page was out of date. Open the admin area again and sign out from there.",
    es: "Esta página estaba desactualizada. Vuelve a abrir el área de administración y cierra la sesión desde allí.",
  },
  "auth.stale_title": {
    en: "This page was out of date",
    es: "Esta página estaba desactualizada",
  },
  "auth.stale_body": {
    en: "Nothing was saved. Open the admin area again and try once more.",
    es: "No se guardó nada. Vuelve a abrir el área de administración e inténtalo otra vez.",
  },
} as const satisfies Record<string, Text>;

export type CopyKey = keyof typeof copy;
