import { useId, type ReactElement, type ReactNode } from "react";
import { styles as ui } from "@/shared/presentation/styles";
import { resolveText, type Languages, type LocalizedText } from "@/shared/domain/localized-text";
import { BilingualText } from "@/shared/presentation/Bilingual";
import { fill, type Text } from "@/shared/presentation/copy";
import { listQueryString, type ListQuery } from "../../application";
import { reviewCopy, type ReviewCopyKey } from "../copy";

/**
 * Staff-authored text in both languages as the form resolves it, so a single-language form
 * shows its one text once (as React text: never markup).
 */
export function localized(text: LocalizedText, languages: Languages): Text {
  return { en: resolveText(text, "en", languages), es: resolveText(text, "es", languages) };
}

/** Staff-authored text in both languages; see `localized`. */
export function Localized(props: { text: LocalizedText; languages: Languages }): ReactElement {
  return <BilingualText text={localized(props.text, props.languages)} />;
}

/**
 * A review copy row whose placeholders take a different value per language (a field's label),
 * filled line by line, so English never shows the Spanish label or the other way round.
 */
export function TPer(props: {
  k: ReviewCopyKey;
  vars: { en: Record<string, string>; es: Record<string, string> };
}): ReactElement {
  const row = reviewCopy[props.k];
  return (
    <BilingualText text={{ en: fill(row.en, props.vars.en), es: fill(row.es, props.vars.es) }} />
  );
}

/**
 * An in-page confirmation of the story page: a `<section role="dialog">` labelled by its
 * heading and described by its body, holding a plain POST form, so it works without
 * JavaScript, as the shared `ConfirmForm` does for copy without per-story placeholders. See
 * design-system/components.md, "Dialog".
 */
export function StoryDialog(props: {
  title: ReactNode;
  body: ReactNode;
  children: (ids: { bodyId: string }) => ReactNode;
}): ReactElement {
  const id = useId();
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className={ui.dialog}
    >
      <h2 id={titleId} className={ui.dialogTitle}>
        {props.title}
      </h2>
      <p id={bodyId} className={ui.dialogBody}>
        {props.body}
      </p>
      {props.children({ bodyId })}
    </section>
  );
}

/**
 * The hidden fields every story form posts: the CSRF token and, in `back`, the list query, so
 * the route can return to the story page with the list's filters.
 */
export function StoryFields(props: { csrfToken: string; query: ListQuery }): ReactElement {
  return (
    <>
      <input type="hidden" name="csrf" value={props.csrfToken} />
      <input type="hidden" name="back" value={listQueryString(props.query)} />
    </>
  );
}
