import { stagingPrefix } from "../domain/keys";
import type { MediaDeps } from "./deps";

/** Deletes staged files by reference; a file already gone is not an error. */
export async function discardStaged(
  deps: Pick<MediaDeps, "staging">,
  refs: readonly string[],
): Promise<void> {
  for (const ref of refs) await deps.staging.delete(ref);
}

/** Deletes every staged file of one record with a single prefix delete. */
export async function discardRecordFiles(
  deps: Pick<MediaDeps, "staging">,
  recordId: string,
): Promise<void> {
  await deps.staging.deletePrefix(stagingPrefix(recordId));
}
