import { resolvePublicForm, type Form, type FormVersion } from "@/modules/definitions/application";
import { isExpired, type InProgress } from "../domain/in-progress";
import type { SubmissionsDeps } from "./deps";
import type { FillState, PostOutcome } from "./fill-state";

export interface OpenContext {
  form: Form;
  version: FormVersion;
  record: InProgress | null;
}

export type PostContext = ({ ok: true } & OpenContext) | { ok: false; outcome: PostOutcome };

const refuse = (outcome: PostOutcome): PostContext => ({ ok: false, outcome });

/**
 * What a post answers against: the form, the version and the record the
 * cookie names, or the outcome that replaces the post. It reads without
 * locks; the use cases lock the record before they write.
 * See specs/use-cases/fill-and-submit-form.md, "Alternate flows and errors".
 */
export async function postContext(
  deps: SubmissionsDeps,
  input: { slug: string; state: FillState; submitToken: string | null },
): Promise<PostContext> {
  const resolved = await resolvePublicForm(deps.definitions, input.slug);
  if (resolved.state !== "open") return refuse({ kind: "gate", state: resolved.state });
  const { form } = resolved;
  const { state } = input;

  const token = state.kind === "done" ? state.submitToken : input.submitToken;
  const alreadySubmitted = async (): Promise<boolean> => {
    if (token === null) return false;
    const submission = await deps.submissions.findBySubmitToken(token);
    return submission?.formId === form.id;
  };

  if (state.kind === "done" && token !== null && (await alreadySubmitted()))
    return refuse({ kind: "submitted", submitToken: token });
  if (state.kind !== "record") return { ok: true, form, version: resolved.version, record: null };

  const record = await deps.inProgress.find(state.id);
  if (!record) {
    return token !== null && (await alreadySubmitted())
      ? refuse({ kind: "submitted", submitToken: token })
      : refuse({ kind: "expired" });
  }
  if (record.formId !== form.id || isExpired(record, deps.clock.now()))
    return refuse({ kind: "expired" });
  const version = await deps.versions.get(deps.definitions, record.versionId);
  if (!version) return refuse({ kind: "expired" });
  return { ok: true, form, version, record };
}
