import type { Form } from "@/modules/definitions/application";
import { discardRecordFiles } from "@/modules/media/application";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { decoyReference } from "../domain/protection";
import { recordHash } from "../domain/record-hash";
import type { SubmissionsDeps } from "./deps";
import { discardQuietly, errorClass } from "./staging";

/**
 * A silent accept inside the caller's unit of work: the locked in-progress
 * row is deleted and nothing is stored; the answer is a decoy reference shaped
 * like a real one. After commit the caller removes the files with
 * `discardAfterSilentAccept`. See specs/system/security.md, "Public form abuse
 * protection".
 */
export async function silentAccept(
  deps: SubmissionsDeps,
  uow: UnitOfWork,
  input: { form: Form; recordId: string; locked: boolean },
): Promise<{ kind: "decoy"; reference: string }> {
  if (input.locked) await deps.inProgress.delete(uow, input.recordId);
  return {
    kind: "decoy",
    reference: decoyReference(input.form.settings.referencePrefix, deps.random),
  };
}

/**
 * After a silent accept has committed: the post's staged files, then the
 * record's whole staging prefix. A failure only logs: the row is gone, so the
 * staging sweep of `jobs.cleanup` removes the prefix a day later.
 */
export async function discardAfterSilentAccept(
  deps: SubmissionsDeps,
  input: { recordId: string; refs: readonly string[] },
): Promise<void> {
  await discardQuietly(deps, input.refs);
  try {
    await discardRecordFiles(deps.media, input.recordId);
  } catch (error) {
    deps.logger.warn("staged files not removed", {
      recordHash: recordHash(input.recordId),
      errorClass: errorClass(error),
    });
  }
}
