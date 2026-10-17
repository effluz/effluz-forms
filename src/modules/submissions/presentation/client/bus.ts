import type { Row } from "./upload-queue";

/*
 * Uploads in flight on this page, so Next and Submit can wait for them, and the rows of each
 * upload field kept across a remount of the form within one server render. See
 * specs/ui-ux/renderer.md, "File upload".
 */

let count = 0;
const listeners = new Set<(count: number) => void>();

function changed(): void {
  for (const listener of listeners) listener(count);
}

export function uploadStarted(): void {
  count += 1;
  changed();
}

export function uploadFinished(): void {
  count = Math.max(0, count - 1);
  changed();
}

export function inFlight(): number {
  return count;
}

/** Calls `listener` on every change of the count; returns the unsubscribe. */
export function onUploadsChange(listener: (count: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const kept = new Map<string, readonly Row[]>();
let lastRenderId: string | null = null;

export function keepRows(fieldKey: string, rows: readonly Row[]): void {
  kept.set(fieldKey, [...rows]);
}

export function keptRows(fieldKey: string): readonly Row[] | null {
  return kept.get(fieldKey) ?? null;
}

/** Forgets every kept row when `renderId` is not the last one seen (a new server render). */
export function resetRowsFor(renderId: string): void {
  if (renderId === lastRenderId) return;
  lastRenderId = renderId;
  // The new render lists staged files without thumbnails, so the old object URLs can go.
  for (const rows of kept.values())
    for (const row of rows) if (row.thumb !== null) URL.revokeObjectURL(row.thumb);
  kept.clear();
}

/*
 * Before this server render has an in-progress record, the first upload creates it and sets its
 * cookie, and a request sent alongside would create a second one, whose cookie the browser
 * keeps instead. So, until a record exists, one upload goes at a time, and posts that do not
 * wait for uploads (Back, the language switch) wait for its answer. An upload refused or lost
 * made no record, so the next one goes alone again. See specs/ui-ux/renderer.md, "File upload".
 */

/** Told whether the upload's answer created the record (an `ok` answer). */
export type UploadAnswered = (recordCreated: boolean) => void;

type Held =
  | { kind: "upload"; start: (answered: UploadAnswered) => void; drop: () => void }
  | { kind: "post"; start: () => void; drop: () => void };

const ignoreAnswer: UploadAnswered = () => undefined;

let gateRenderId: string | null = null;
let recordExists = false;
let firstOpen = false;
let held: Held[] = [];

/**
 * Starts a server render's gate from whether that render has a record. Repeated calls for the
 * same render (a remount after a failed post) keep what the gate has learned since; a new
 * render drops whatever is still held.
 */
export function recordStateFor(renderId: string, hasRecord: boolean): void {
  if (renderId === gateRenderId) return;
  gateRenderId = renderId;
  recordExists = hasRecord;
  firstOpen = false;
  const dropped = held;
  held = [];
  for (const entry of dropped) entry.drop();
}

function sendFirst(start: (answered: UploadAnswered) => void): void {
  firstOpen = true;
  const renderId = gateRenderId;
  let answered = false;
  start((recordCreated) => {
    if (answered || renderId !== gateRenderId) return;
    answered = true;
    firstOpen = false;
    if (recordCreated) recordExists = true;
    release();
  });
}

function release(): void {
  if (recordExists) {
    const all = held;
    held = [];
    for (const entry of all) {
      if (entry.kind === "upload") entry.start(ignoreAnswer);
      else entry.start();
    }
    return;
  }
  // Still no record: the next held upload goes alone; posts wait until no upload is held.
  const index = held.findIndex((entry) => entry.kind === "upload");
  const next = held[index];
  if (next?.kind === "upload") {
    held.splice(index, 1);
    sendFirst(next.start);
    return;
  }
  const posts = held;
  held = [];
  for (const entry of posts) if (entry.kind === "post") entry.start();
}

/**
 * Sends an upload now, or holds it while the first upload of a render without a record is open.
 * Returns the withdrawal: true when the upload was still held and now never leaves.
 */
export function queueUpload(
  start: (answered: UploadAnswered) => void,
  drop: () => void,
): () => boolean {
  if (recordExists) start(ignoreAnswer);
  else if (firstOpen) {
    const entry: Held = { kind: "upload", start, drop };
    held.push(entry);
    return () => {
      const index = held.indexOf(entry);
      if (index === -1) return false;
      held.splice(index, 1);
      return true;
    };
  } else sendFirst(start);
  return () => false;
}

/** Whether a post that does not wait for uploads must wait for the first upload's answer. */
export function holdsPosts(): boolean {
  return !recordExists && firstOpen;
}

/** Sends a post now, or once the first upload of a render without a record has answered. */
export function queuePost(start: () => void, drop: () => void): void {
  if (holdsPosts()) held.push({ kind: "post", start, drop });
  else start();
}
