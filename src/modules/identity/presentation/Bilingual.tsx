import { BilingualText } from "@/shared/presentation/Bilingual";
import { copy, type CopyKey } from "./copy";

/** The sign-in copy for `k` in both languages, through the shared `BilingualText`. */
export function Bilingual({ k, vars = {} }: { k: CopyKey; vars?: Record<string, string> }) {
  return <BilingualText text={copy[k]} vars={vars} />;
}
