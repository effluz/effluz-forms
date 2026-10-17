/**
 * The rows of an enhanced upload field: one per chosen file, with its own progress, result and
 * actions. See specs/ui-ux/renderer.md, "File upload".
 */

export type RowState =
  | { status: "uploading"; percent: number }
  | { status: "uploaded" }
  | { status: "failed"; message: string };

export interface Row {
  localId: string;
  /** The staged file's id once the server holds it. */
  id: string | null;
  /** The chosen file's name with script, or the `file_row` label of a file staged earlier. */
  name: string;
  /** The formatted size; empty when the name already carries it. */
  size: string;
  kind: "image" | "video";
  /** An object URL of the chosen image, or null. */
  thumb: string | null;
  state: RowState;
}

export type QueueAction =
  | { type: "add"; rows: Row[] }
  | { type: "progress"; localId: string; percent: number }
  | { type: "done"; localId: string; id: string; label: string }
  | { type: "fail"; localId: string; message: string }
  | { type: "retry"; localId: string }
  | { type: "remove"; localId: string };

const patch = (rows: readonly Row[], localId: string, change: (row: Row) => Row): Row[] =>
  rows.map((row) => (row.localId === localId ? change(row) : row));

/**
 * `done` keeps the chosen name on the row (the spec shows it while the page is open); the
 * server's `label` names the file only where no name is known, on the next server render.
 */
export function queueReducer(rows: readonly Row[], action: QueueAction): Row[] {
  switch (action.type) {
    case "add":
      return [...rows, ...action.rows];
    case "progress":
      return patch(rows, action.localId, (row) =>
        row.state.status === "uploading"
          ? { ...row, state: { status: "uploading", percent: action.percent } }
          : row,
      );
    case "done":
      return patch(rows, action.localId, (row) => ({
        ...row,
        id: action.id,
        state: { status: "uploaded" },
      }));
    case "fail":
      return patch(rows, action.localId, (row) => ({
        ...row,
        state: { status: "failed", message: action.message },
      }));
    case "retry":
      return patch(rows, action.localId, (row) => ({
        ...row,
        state: { status: "uploading", percent: 0 },
      }));
    case "remove":
      return rows.filter((row) => row.localId !== action.localId);
  }
}

/** User-perceived characters, so an accent or an emoji is never cut in half. */
function characters(text: string): string[] {
  if (typeof Intl.Segmenter !== "function") return Array.from(text);
  return Array.from(new Intl.Segmenter().segment(text), (part) => part.segment);
}

/** A long file name shortened in the middle, so its start and its extension stay readable. */
export function middleEllipsis(name: string, max = 32): string {
  const chars = characters(name);
  if (chars.length <= max) return name;
  const lead = Math.floor((max - 1) / 2);
  const trail = max - 1 - lead;
  return `${chars.slice(0, lead).join("")}…${chars.slice(chars.length - trail).join("")}`;
}

/**
 * The advisory check before uploading, by the declared size and type only; the server decides
 * by content, so an empty or unfamiliar declared type passes.
 */
export function precheckFile(
  file: { size: number; type: string },
  limits: { maxBytes: number; kinds: readonly ("image" | "video")[] },
): "file_too_large" | "file_wrong_type" | null {
  if (file.size > limits.maxBytes) return "file_too_large";
  const declared = file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("video/")
      ? "video"
      : null;
  if (declared !== null && !limits.kinds.includes(declared)) return "file_wrong_type";
  return null;
}
