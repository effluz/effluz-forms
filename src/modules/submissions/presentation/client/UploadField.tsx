"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import type { Locale } from "@/shared/domain/localized-text";
import { ErrorIcon } from "../ErrorIcon";
import type { FileRowView } from "../fields/types";
import { formatBytes, formatNumber } from "../format";
import { styles } from "../styles";
import { keepRows, keptRows, uploadFinished, uploadStarted } from "./bus";
import { fill } from "./form-dom";
import { RefusedFilesContext } from "./refused-files";
import { middleEllipsis, precheckFile, queueReducer, type Row } from "./upload-queue";

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
    remove: string;
    retry: string;
    removed: string;
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

interface UploadAnswer {
  ok?: unknown;
  file?: { id?: unknown };
  label?: unknown;
  message?: unknown;
}

function parseAnswer(text: string): UploadAnswer | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
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
 * With script, each chosen file uploads at once with its own progress row, and the input is
 * cleared so the page post does not resend it.
 */
export function UploadField(props: UploadFieldProps): ReactElement {
  const refused = useContext(RefusedFilesContext).filter((r) => r.fieldKey === props.fieldKey);
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
  const [announcement, setAnnouncement] = useState("");
  const [alert, setAlert] = useState("");
  const chosen = useRef(new Map<string, File>());
  const nextLocalId = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEnhanced(true);
  }, []);

  useEffect(() => {
    keepRows(props.fieldKey, rows);
  }, [props.fieldKey, rows]);

  const { text, locale } = props;
  const shortName = (row: Row): string => middleEllipsis(row.name);

  function upload(localId: string, file: File, name: string): void {
    const body = new FormData();
    body.set("field", props.fieldKey);
    body.set("_locale", locale);
    body.set("file", file);
    const request = new XMLHttpRequest();
    let open = true;
    let milestone = 0;
    const settle = (): void => {
      if (!open) return;
      open = false;
      uploadFinished();
    };
    const fail = (message: string): void => {
      dispatch({ type: "fail", localId, message });
      setAlert(message);
    };
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total === 0) return;
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      dispatch({ type: "progress", localId, percent });
      const reached = Math.floor(percent / MILESTONE) * MILESTONE;
      if (reached > milestone && reached < 100) {
        milestone = reached;
        setAnnouncement(
          `${middleEllipsis(name)}, ${fill(text.uploading, { percent: formatNumber(reached, locale) })}`,
        );
      }
    };
    request.onload = () => {
      settle();
      const answer = parseAnswer(request.responseText);
      const id = answer?.file?.id;
      if (
        request.status >= 200 &&
        request.status < 300 &&
        answer?.ok === true &&
        typeof id === "string"
      ) {
        const label = typeof answer.label === "string" ? answer.label : name;
        dispatch({ type: "done", localId, id, label });
        setAnnouncement(`${middleEllipsis(name)}, ${text.uploaded}`);
        return;
      }
      const message = typeof answer?.message === "string" ? answer.message : text.failed;
      fail(fill(message, { file: middleEllipsis(name) }));
    };
    request.onerror =
      request.onabort =
      request.ontimeout =
        () => {
          settle();
          fail(fill(text.failed, { file: middleEllipsis(name) }));
        };
    request.open("POST", `/f/${encodeURIComponent(props.slug)}/files`);
    uploadStarted();
    request.send(body);
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
        setAlert(message);
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

  function retry(row: Row): void {
    const file = chosen.current.get(row.localId);
    if (file === undefined) return;
    dispatch({ type: "retry", localId: row.localId });
    upload(row.localId, file, file.name);
  }

  async function remove(row: Row): Promise<void> {
    if (row.id !== null) {
      try {
        const response = await fetch(
          `/f/${encodeURIComponent(props.slug)}/files/${encodeURIComponent(row.id)}`,
          { method: "DELETE" },
        );
        // A 404 means the file is already gone.
        if (!response.ok && response.status !== 404) return;
      } catch {
        return;
      }
    }
    if (row.thumb !== null) URL.revokeObjectURL(row.thumb);
    chosen.current.delete(row.localId);
    dispatch({ type: "remove", localId: row.localId });
    setAnnouncement(fill(text.removed, { file: shortName(row) }));
    input.current?.focus();
  }

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
                <span id={`${row.localId}-name`} className={styles.fileName}>
                  {row.size === "" ? shortName(row) : `${shortName(row)}, ${row.size}`}
                </span>
                <RowStatus
                  row={row}
                  uploading={text.uploading}
                  uploaded={text.uploaded}
                  locale={locale}
                />
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
            ) : row.state.status === "uploading" ? null : (
              <span className={styles.fileActions}>
                {row.state.status === "failed" && chosen.current.has(row.localId) ? (
                  <button
                    type="button"
                    onClick={() => {
                      retry(row);
                    }}
                    aria-describedby={`${row.localId}-name`}
                    className={styles.removeButton}
                  >
                    {text.retry}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void remove(row)}
                  aria-describedby={`${row.localId}-name`}
                  className={styles.removeButton}
                >
                  {text.remove}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className={styles.visuallyHidden} aria-live="polite" data-announce="">
        {announcement}
      </p>
      <p className={styles.visuallyHidden} aria-live="assertive" data-alert="">
        {alert}
      </p>
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
