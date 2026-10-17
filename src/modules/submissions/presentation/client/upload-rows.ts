import { fill } from "./form-dom";
import { middleEllipsis, type QueueAction, type Row } from "./upload-queue";

/*
 * What Retry and Remove do to an enhanced upload row, apart from React and the network, so each
 * effect and its order can be checked. See specs/ui-ux/renderer.md, "File upload".
 */

/** The buttons an enhanced row shows, in order. */
export function rowButtons(row: Row, fileKept: boolean): ("retry" | "remove")[] {
  return row.state.status === "failed" && fileKept ? ["retry", "remove"] : ["remove"];
}

export interface RowActionDeps {
  dispatch: (action: QueueAction) => void;
  /** The chosen file of a row, kept in memory for Retry. */
  fileFor: (localId: string) => File | undefined;
  forgetFile: (localId: string) => void;
  /** Starts (or starts again) the row's upload. */
  start: (localId: string, file: File) => void;
  /** Cancels the row's upload, held or open. */
  cancel: (localId: string) => void;
  /** Deletes a staged file from the server. */
  removeStaged: (id: string) => Promise<"gone" | "failed">;
  /** Focuses the field's file input, where focus goes when a row's button goes away. */
  focusControl: () => void;
  revoke: (url: string) => void;
  announce: (text: string) => void;
  alert: (text: string) => void;
  /** Shows, or with null clears, the message under a row whose removal failed. */
  removeFailed: (localId: string, message: string | null) => void;
  text: { removed: string; removeFailed: string };
}

export function createRowActions(deps: RowActionDeps): {
  retry: (row: Row) => void;
  remove: (row: Row) => Promise<void>;
} {
  const shortName = (row: Row): string => middleEllipsis(row.name);
  return {
    retry(row) {
      const file = deps.fileFor(row.localId);
      if (file === undefined) return;
      deps.dispatch({ type: "retry", localId: row.localId });
      deps.start(row.localId, file);
      // The Retry button unmounts with the row's new state.
      deps.focusControl();
    },
    async remove(row) {
      if (row.state.status === "uploading") {
        // Not staged yet: the request stops and nothing needs deleting.
        deps.cancel(row.localId);
      } else if (row.id !== null && (await deps.removeStaged(row.id)) === "failed") {
        // The row stays, with its Remove button, and says why.
        const message = fill(deps.text.removeFailed, { file: shortName(row) });
        deps.removeFailed(row.localId, message);
        deps.alert(message);
        return;
      }
      deps.removeFailed(row.localId, null);
      if (row.thumb !== null) deps.revoke(row.thumb);
      deps.forgetFile(row.localId);
      deps.dispatch({ type: "remove", localId: row.localId });
      deps.announce(fill(deps.text.removed, { file: shortName(row) }));
      deps.focusControl();
    },
  };
}

/**
 * A live region writer that clears the region first and writes the text on the next frame, so a
 * message equal to the last one is announced again. Only the latest text of one frame is written.
 */
export function reannouncing(
  set: (text: string) => void,
  nextFrame: (run: () => void) => void,
): (text: string) => void {
  let latest = 0;
  return (text) => {
    latest += 1;
    const mine = latest;
    set("");
    nextFrame(() => {
      if (mine === latest) set(text);
    });
  };
}
