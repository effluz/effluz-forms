import { reachability, type Unreachable } from "../domain/form";
import { publicUrl, type DefinitionsDeps } from "./deps";

export interface ShareInfo {
  url: string;
  reachable: boolean;
  reason: null | Unreachable;
}

/**
 * The public link of a form and whether the public can open it right now,
 * for the Share tab. Null for an unknown form.
 * See specs/use-cases/manage-form-settings.md and specs/ui-ux/manager.md, "Share tab".
 */
export async function shareInfo(deps: DefinitionsDeps, formId: string): Promise<ShareInfo | null> {
  const form = await deps.forms.findById(formId);
  if (!form) return null;
  const state = reachability(form, deps.clock.now());
  return {
    url: publicUrl(deps, form.slug),
    reachable: state.reachable,
    reason: state.reachable ? null : state.reason,
  };
}
