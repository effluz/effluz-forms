export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

type Edit = { kind: DiffPart["kind"]; text: string };

/**
 * The most edits (removed plus added tokens) the diff searches for. Corrections are small, so
 * this is never reached in practice; two texts that differ by more are shown as one removed
 * block followed by one added block, which is still a correct, reassemblable diff and keeps the
 * work and memory bounded (the search stores one row per edit, so memory grows with its square).
 */
const MAX_EDIT_DISTANCE = 1500;

const tokenize = (text: string): string[] => text.match(/\S+|\s+/g) ?? [];

/**
 * Word-level differences between the original and the corrected text. Tokens are runs of
 * non-space or of space, so both texts reassemble exactly from the parts (`same` plus `removed`
 * is the original, `same` plus `added` the corrected text). Adjacent parts of one kind are
 * merged. Inside one changed stretch every removal comes before every addition, and between
 * equally short edit scripts the one that deletes before it inserts wins.
 */
export function wordDiff(original: string, corrected: string): DiffPart[] {
  const a = tokenize(original);
  const b = tokenize(corrected);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const edits: Edit[] = [];
  for (let i = 0; i < start; i += 1) edits.push({ kind: "same", text: a[i] as string });
  edits.push(...middleEdits(a.slice(start, endA), b.slice(start, endB)));
  for (let i = endA; i < a.length; i += 1) edits.push({ kind: "same", text: a[i] as string });

  return mergeEdits(edits);
}

/** A removed part directly followed by an added part counts as one change. */
export function changeCount(parts: readonly DiffPart[]): number {
  let count = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] as DiffPart;
    if (part.kind === "same") continue;
    count += 1;
    if (part.kind === "removed" && parts[i + 1]?.kind === "added") i += 1;
  }
  return count;
}

/** Myers' O(ND) shortest edit script over two token lists that share no first or last token. */
function middleEdits(a: readonly string[], b: readonly string[]): Edit[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ kind: "added", text }));
  if (m === 0) return a.map((text) => ({ kind: "removed", text }));

  const maxD = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = maxD + 1;
  const v = new Int32Array(2 * maxD + 3);
  // rows[d][k + d] is the furthest x reached on diagonal k after d edits.
  const rows: Int32Array[] = [];
  let found = -1;

  search: for (let d = 0; d <= maxD; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))) {
        x = v[offset + k + 1] as number; // step down: an insertion
      } else {
        x = (v[offset + k - 1] as number) + 1; // step right: a deletion
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        rows.push(v.slice(offset - d, offset + d + 1));
        found = d;
        break search;
      }
    }
    rows.push(v.slice(offset - d, offset + d + 1));
  }

  if (found < 0) {
    return [
      ...a.map((text): Edit => ({ kind: "removed", text })),
      ...b.map((text): Edit => ({ kind: "added", text })),
    ];
  }

  // Walk the path back from (n, m), collecting edits in reverse.
  const reversed: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const previous = rows[d - 1] as Int32Array;
    const k = x - y;
    const cameFromAbove =
      k === -d ||
      (k !== d && (previous[k - 1 + d - 1] as number) < (previous[k + 1 + d - 1] as number));
    const previousK = cameFromAbove ? k + 1 : k - 1;
    const previousX = previous[previousK + d - 1] as number;
    const previousY = previousX - previousK;
    // The diagonal run after the edit.
    const editX = cameFromAbove ? previousX : previousX + 1;
    while (x > editX) {
      x -= 1;
      y -= 1;
      reversed.push({ kind: "same", text: a[x] as string });
    }
    if (cameFromAbove) {
      reversed.push({ kind: "added", text: b[previousY] as string });
    } else {
      reversed.push({ kind: "removed", text: a[previousX] as string });
    }
    x = previousX;
    y = previousY;
  }
  while (x > 0) {
    x -= 1;
    reversed.push({ kind: "same", text: a[x] as string });
  }
  return reversed.reverse();
}

/** Orders each changed stretch removals first, then merges neighbours of one kind. */
function mergeEdits(edits: readonly Edit[]): DiffPart[] {
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    if (text === "") return;
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let removed = "";
  let added = "";
  const flush = () => {
    push("removed", removed);
    push("added", added);
    removed = "";
    added = "";
  };
  for (const edit of edits) {
    if (edit.kind === "removed") removed += edit.text;
    else if (edit.kind === "added") added += edit.text;
    else {
      flush();
      push("same", edit.text);
    }
  }
  flush();
  return parts;
}
