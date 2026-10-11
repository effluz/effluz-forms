import type { LocalizedText } from "@/shared/domain/localized-text";
import { BilingualText } from "@/shared/presentation/Bilingual";
import { bilingualTitle, titleText } from "./view-models";

/**
 * A form's staff-authored title, rendered as text: both languages when it has
 * both, otherwise the one it has, marked with its language; the slug when it
 * has none.
 */
export function FormTitle({ title, slug }: { title: LocalizedText; slug: string }) {
  const both = bilingualTitle(title);
  if (both !== null) return <BilingualText text={both} />;
  const text = titleText(title, slug);
  if (title.es?.trim() === text) return <span lang="es">{text}</span>;
  return <>{text}</>;
}
