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
