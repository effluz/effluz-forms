import type { Text } from "@/shared/presentation/copy";

/**
 * The three chrome rows the client error boundary shows, alone so the boundary does not load
 * the copy tables. `copy.test.ts` keeps them equal to `error_title`, `error_body` and
 * `try_again` in specs/ui-ux/renderer.md, "Fixed chrome copy".
 */
export const errorCopy: { title: Text; body: Text; tryAgain: Text } = {
  title: { en: "Something went wrong", es: "Algo salió mal" },
  body: {
    en: "Your answers on this page were not saved. Please try again.",
    es: "Las respuestas de esta página no se guardaron. Inténtalo de nuevo.",
  },
  tryAgain: { en: "Try again", es: "Intentar de nuevo" },
};
