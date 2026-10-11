"use client";

import { type ReactElement, useContext } from "react";
import type { Locale } from "@/shared/domain/localized-text";
import { ErrorIcon } from "../ErrorIcon";
import type { FileRowView } from "../fields/types";
import { styles } from "../styles";
import { RefusedFilesContext } from "./refused-files";

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

/**
 * The upload control of a file field (specs/ui-ux/renderer.md, "File upload"). Rendered on
 * the server it is the no-script control: a native file input posted with the page, the
 * staged files with a Remove button each, and the field's refused files in its error slot.
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
      <div className={styles.dropzone}>
        <input
          id={props.inputId}
          name={props.fieldKey}
          type="file"
          multiple={props.maxFiles > 1}
          accept={props.accept}
          className={styles.fileInput}
          aria-required={props.required || undefined}
          aria-invalid={showsError ? true : undefined}
          aria-describedby={describedBy}
        />
      </div>
      <p id={props.countId} className={styles.count} aria-live="polite">
        {props.initialCount}
      </p>
      <ul className={styles.fileList}>
        {props.initial.map((file) => (
          <li key={file.id} className={styles.fileRow} data-file-id={file.id} data-kind={file.kind}>
            <span id={`${file.id}-name`} className={styles.fileName}>
              {file.label}
            </span>
            <button
              type="submit"
              name="_action"
              value={`remove:${file.id}`}
              aria-describedby={`${file.id}-name`}
              className={styles.removeButton}
            >
              {props.text.remove}
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.visuallyHidden} aria-live="polite" data-announce="" />
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
