"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { Locale } from "@/shared/domain/localized-text";
import { ErrorIcon } from "../ErrorIcon";
import type { FileRowView } from "../fields/types";
import { formatBytes, formatNumber } from "../format";
import { styles } from "../styles";
import { keepRows, keptRows } from "./bus";
import { fill } from "./form-dom";
import { RefusedFilesContext } from "./refused-files";
import { RenderedAtContext } from "./rendered-at";
import { middleEllipsis, precheckFile, queueReducer, type Row } from "./upload-queue";
import { removeFile, sendUpload, type UploadHandle } from "./upload-request";
import { createRowActions, reannouncing, rowButtons } from "./upload-rows";

/** Runs after the next frame was drawn, so a cleared live region is seen empty first. */
const afterNextFrame = (run: () => void): void => {
  requestAnimationFrame(() => {
    requestAnimationFrame(run);
  });
};

export interface UploadFieldProps {
  slug: string;
  fieldKey: string;
  inputId: string;
  errorId: string;
  countId: string;
  describedBy: string;
  accept: string;
  required: boolean;
  maxFiles: number;
  maxBytes: number;
  kinds: readonly ("image" | "video")[];
  error: string | null;
  initial: FileRowView[];
  initialCount: string;
  text: {
    chooseFiles: string;
    uploading: string;
    uploaded: string;
    // "{file}" is left in these two announcements; "{percent}" too in the first.
    uploadingFile: string;
    uploadedFile: string;
    remove: string;
    retry: string;
    removed: string;
    // "{file}" is left in this one too.
    removeFailed: string;
    count: string;
    countOne: string;
    // "{file}" is left in these for the client to fill.
    failed: string;
    tooLarge: string;
    wrongType: string;
  };
  locale: Locale;
}

/** A staged file of the server render: its `file_row` label already carries the size. */
const stagedRow = (file: FileRowView): Row => ({
  localId: file.id,
  id: file.id,
  name: file.label,
  size: "",
  kind: file.kind,
  thumb: null,
  state: { status: "uploaded" },
});

/**
 * Rows kept from before a remount of the form, else the server's. A request still open at the
 * remount answers an unmounted field, so its row is left to the next server render.
 */
function startingRows(props: UploadFieldProps): Row[] {
  const kept = keptRows(props.fieldKey);
  if (kept === null) return props.initial.map(stagedRow);
  return kept.filter((row) => row.state.status !== "uploading");
}

const MILESTONE = 25;

function FilmIcon(): ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.thumb}>
      <rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" />
      <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" />
    </svg>
  );
}

/**
 * The upload control of a file field (specs/ui-ux/renderer.md, "File upload"). Rendered on
 * the server it is the no-script control: a native file input posted with the page, the
 * staged files with a Remove button each, and the field's refused files in its error slot.
 * With script, each chosen file uploads early with its own progress row (at once, or one at a
 * time until the page has an in-progress record; see `bus.ts`), and the input is cleared so the
 * page post does not resend it. The native input is visually hidden but focusable; its label
 * carries `choose_files` as the visible control.
 */
export function UploadField(props: UploadFieldProps): ReactElement {
  const refused = useContext(RefusedFilesContext).filter((r) => r.fieldKey === props.fieldKey);
  const renderedAt = useContext(RenderedAtContext);
  const messages =
    refused.length > 0 ? refused.map((r) => r.message) : props.error ? [props.error] : [];
  const showsError = messages.length > 0;
  const describedBy =
    showsError && !props.describedBy.split(" ").includes(props.errorId)
      ? `${props.describedBy} ${props.errorId}`
      : props.describedBy;

  // A remount after a failed post (kept rows) is enhanced from its first paint.
  const [enhanced, setEnhanced] = useState(() => keptRows(props.fieldKey) !== null);
  const [rows, dispatch] = useReducer(queueReducer, props, startingRows);
  const [dragging, setDragging] = useState(false);
  // Rows whose removal failed, by local id, with the message shown under them.
  const [removeFailed, setRemoveFailed] = useState<Readonly<Record<string, string>>>({});
  const chosen = useRef(new Map<string, File>());
  const handles = useRef(new Map<string, UploadHandle>());
  const nextLocalId = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  // The live regions are written in place, never by React, so a repeated message is heard again.
  const announceRegion = useRef<HTMLParagraphElement>(null);
  const alertRegion = useRef<HTMLParagraphElement>(null);
  const say = useMemo(() => {
    const writer = (region: { current: HTMLElement | null }) =>
      reannouncing((text) => {
        if (region.current) region.current.textContent = text;
      }, afterNextFrame);
    return { announce: writer(announceRegion), alert: writer(alertRegion) };
  }, []);

  useEffect(() => {
    setEnhanced(true);
  }, []);

  useEffect(() => {
    keepRows(props.fieldKey, rows);
  }, [props.fieldKey, rows]);

  const { text, locale } = props;
  const shortName = (row: Row): string => middleEllipsis(row.name);

  function upload(localId: string, file: File, name: string): void {
    let milestone = 0;
    const handle = sendUpload(
      { slug: props.slug, fieldKey: props.fieldKey, renderedAt, locale, file },
      {
        progress: (percent) => {
          dispatch({ type: "progress", localId, percent });
          const reached = Math.floor(percent / MILESTONE) * MILESTONE;
          if (reached > milestone && reached < 100) {
            milestone = reached;
            say.announce(
              fill(text.uploadingFile, {
                file: middleEllipsis(name),
                percent: formatNumber(reached, locale),
              }),
            );
          }
        },
        settled: (outcome) => {
          handles.current.delete(localId);
          if (outcome.ok) {
            dispatch({ type: "done", localId, id: outcome.id, label: outcome.label ?? name });
            say.announce(fill(text.uploadedFile, { file: middleEllipsis(name) }));
            return;
          }
          const message = fill(outcome.message ?? text.failed, { file: middleEllipsis(name) });
          dispatch({ type: "fail", localId, message });
          say.alert(message);
        },
      },
    );
    handles.current.set(localId, handle);
  }

  function choose(files: readonly File[]): void {
    const added: Row[] = [];
    const toSend: { localId: string; file: File }[] = [];
    for (const file of files) {
      nextLocalId.current += 1;
      const localId = `${props.fieldKey}-new-${String(nextLocalId.current)}`;
      const kind = file.type.startsWith("video/") ? "video" : "image";
      const base = {
        localId,
        id: null,
        name: file.name,
        size: formatBytes(file.size, locale),
        kind,
      } as const;
      const refusal = precheckFile(file, { maxBytes: props.maxBytes, kinds: props.kinds });
      if (refusal !== null) {
        const template = refusal === "file_too_large" ? text.tooLarge : text.wrongType;
        const message = fill(template, { file: middleEllipsis(file.name) });
        added.push({ ...base, thumb: null, state: { status: "failed", message } });
        say.alert(message);
        continue;
      }
      const thumb = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      added.push({ ...base, thumb, state: { status: "uploading", percent: 0 } });
      chosen.current.set(localId, file);
      toSend.push({ localId, file });
    }
    if (added.length === 0) return;
    dispatch({ type: "add", rows: added });
    for (const { localId, file } of toSend) upload(localId, file, file.name);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.currentTarget.files ?? []);
    // Cleared so the page post never sends these files a second time.
    event.currentTarget.value = "";
    choose(files);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(true);
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    choose(Array.from(event.dataTransfer.files));
  }

  const actions = createRowActions({
    dispatch,
    fileFor: (localId) => chosen.current.get(localId),
    forgetFile: (localId) => {
      chosen.current.delete(localId);
    },
    start: (localId, file) => {
      upload(localId, file, file.name);
    },
    cancel: (localId) => {
      handles.current.get(localId)?.cancel();
      handles.current.delete(localId);
    },
    removeStaged: (id) => removeFile(props.slug, id),
    focusControl: () => {
      input.current?.focus();
    },
    revoke: (url) => {
      URL.revokeObjectURL(url);
    },
    announce: say.announce,
    alert: say.alert,
    removeFailed: (localId, message) => {
      setRemoveFailed((failures) => {
        if (message !== null) return { ...failures, [localId]: message };
        if (!(localId in failures)) return failures;
        return Object.fromEntries(Object.entries(failures).filter(([id]) => id !== localId));
      });
    },
    text: { removed: text.removed, removeFailed: text.removeFailed },
  });

  const uploaded = rows.filter((row) => row.state.status === "uploaded").length;
  const count = enhanced
    ? fill(props.maxFiles === 1 ? text.countOne : text.count, {
        count: formatNumber(uploaded, locale),
        max: formatNumber(props.maxFiles, locale),
      })
    : props.initialCount;

  return (
    <div
      className={styles.upload}
      data-upload=""
      data-slug={props.slug}
      data-field-key={props.fieldKey}
      data-max-files={props.maxFiles}
      data-max-bytes={props.maxBytes}
      data-kinds={props.kinds.join(" ")}
    >
      <div
        className={styles.dropzone}
        data-drag={enhanced && dragging ? "" : undefined}
        onDragOver={enhanced ? onDragOver : undefined}
        onDragLeave={
          enhanced
            ? () => {
                setDragging(false);
              }
            : undefined
        }
        onDrop={enhanced ? onDrop : undefined}
      >
        <input
          ref={input}
          id={props.inputId}
          name={props.fieldKey}
          type="file"
          multiple={props.maxFiles > 1}
          accept={props.accept}
          className={styles.fileInput}
          aria-required={props.required || undefined}
          aria-invalid={showsError ? true : undefined}
          aria-describedby={describedBy}
          onChange={enhanced ? onChange : undefined}
        />
        {/* The control's visible text, in the page's language; the input itself is hidden but
            focusable, and its focus ring is drawn here. */}
        <label htmlFor={props.inputId} className={styles.chooseButton}>
          {text.chooseFiles}
        </label>
      </div>
      <p id={props.countId} className={styles.count} aria-live="polite">
        {count}
      </p>
      <ul className={styles.fileList}>
        {rows.map((row) => (
          <li
            key={row.localId}
            className={styles.fileRow}
            data-file-id={row.id ?? undefined}
            data-kind={row.kind}
          >
            {enhanced && row.thumb !== null ? (
              // The object URL of the chosen file; it never leaves the browser.
              <img src={row.thumb} alt="" className={styles.thumb} />
            ) : enhanced && row.kind === "video" ? (
              <FilmIcon />
            ) : null}
            {enhanced ? (
              <span className={styles.fileBody}>
                {/* Name and size apart, laid out side by side: no punctuation to translate. */}
                <span className={styles.fileLine}>
                  <span id={`${row.localId}-name`} className={styles.fileName}>
                    {shortName(row)}
                  </span>
                  {row.size === "" ? null : <span className={styles.fileSize}>{row.size}</span>}
                </span>
                <RowStatus
                  row={row}
                  uploading={text.uploading}
                  uploaded={text.uploaded}
                  locale={locale}
                />
                {removeFailed[row.localId] === undefined ? null : (
                  <span
                    id={`${row.localId}-remove-failed`}
                    className={[styles.fileStatus, styles.errorLine].join(" ")}
                  >
                    <ErrorIcon />
                    {removeFailed[row.localId]}
                  </span>
                )}
              </span>
            ) : (
              <span id={`${row.localId}-name`} className={styles.fileName}>
                {row.name}
              </span>
            )}
            {!enhanced ? (
              <button
                type="submit"
                name="_action"
                value={`remove:${row.id ?? row.localId}`}
                aria-describedby={`${row.localId}-name`}
                className={styles.removeButton}
              >
                {text.remove}
              </button>
            ) : (
              <span className={styles.fileActions}>
                {rowButtons(row, chosen.current.has(row.localId)).map((button) =>
                  button === "retry" ? (
                    <button
                      key="retry"
                      type="button"
                      onClick={() => {
                        actions.retry(row);
                      }}
                      aria-describedby={`${row.localId}-name`}
                      className={styles.removeButton}
                    >
                      {text.retry}
                    </button>
                  ) : (
                    <button
                      key="remove"
                      type="button"
                      onClick={() => void actions.remove(row)}
                      aria-describedby={
                        removeFailed[row.localId] === undefined
                          ? `${row.localId}-name`
                          : `${row.localId}-name ${row.localId}-remove-failed`
                      }
                      className={styles.removeButton}
                    >
                      {text.remove}
                    </button>
                  ),
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p
        ref={announceRegion}
        className={styles.visuallyHidden}
        aria-live="polite"
        data-announce=""
      />
      <p ref={alertRegion} className={styles.visuallyHidden} aria-live="assertive" data-alert="" />
      <p id={props.errorId} className={styles.error} aria-live="assertive">
        {messages.map((message, index) => (
          <span key={index} className={styles.errorLine}>
            <ErrorIcon />
            {message}
          </span>
        ))}
      </p>
    </div>
  );
}

/** A row's progress bar and "Uploading {percent}%", "Uploaded", or its error. */
function RowStatus(props: {
  row: Row;
  uploading: string;
  uploaded: string;
  locale: Locale;
}): ReactElement {
  const { state } = props.row;
  if (state.status === "uploading") {
    return (
      <>
        <span className={styles.fileBar} aria-hidden="true">
          {/* The fill's width is the only runtime value; the CSP allows inline styles. */}
          <span style={{ width: `${String(state.percent)}%` }} />
        </span>
        <span className={styles.fileStatus}>
          {fill(props.uploading, { percent: formatNumber(state.percent, props.locale) })}
        </span>
      </>
    );
  }
  if (state.status === "uploaded")
    return <span className={styles.fileStatus}>{props.uploaded}</span>;
  return (
    <span className={[styles.fileStatus, styles.errorLine].join(" ")}>
      <ErrorIcon />
      {state.message}
    </span>
  );
}
