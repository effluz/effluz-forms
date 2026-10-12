import type { Locale } from "@/shared/domain/localized-text";
import { queueUpload, uploadFinished, uploadStarted } from "./bus";

/*
 * The early upload and removal requests of an upload field, over the routes'
 * JSON (`POST /f/<slug>/files`, `DELETE /f/<slug>/files/<id>`). Browser code
 * without React; the server decides every file by content. See
 * specs/ui-ux/renderer.md, "File upload".
 */

export interface UploadRequest {
  slug: string;
  fieldKey: string;
  locale: Locale;
  file: Blob;
}

/** The server's answer: the staged file, or its message with `{file}` left for the client. */
export type UploadOutcome =
  { ok: true; id: string; label: string | null } | { ok: false; message: string | null };

export interface UploadHandlers {
  progress: (percent: number) => void;
  /** Called once per request, when it answers or fails. */
  settled: (outcome: UploadOutcome) => void;
}

/** The part of `XMLHttpRequest` an upload uses. */
export type XhrLike = Pick<
  XMLHttpRequest,
  "open" | "send" | "status" | "responseText" | "onload" | "onerror" | "onabort" | "ontimeout"
> & { readonly upload: Pick<XMLHttpRequestUpload, "onprogress"> };

function parseOutcome(status: number, text: string): UploadOutcome {
  let answer: unknown = null;
  try {
    answer = JSON.parse(text);
  } catch {
    answer = null;
  }
  if (typeof answer !== "object" || answer === null) return { ok: false, message: null };
  const { ok, file, label, message } = answer as Record<string, unknown>;
  const id =
    typeof file === "object" && file !== null ? (file as Record<string, unknown>).id : undefined;
  if (status >= 200 && status < 300 && ok === true && typeof id === "string")
    return { ok: true, id, label: typeof label === "string" ? label : null };
  return { ok: false, message: typeof message === "string" ? message : null };
}

/**
 * Uploads one file with progress. It counts as in flight from now, and leaves when the gate in
 * `bus.ts` lets it: at once once the render has a record, else alone. The multipart file name is
 * always `upload`, so the original name never leaves the browser.
 */
export function sendUpload(
  request: UploadRequest,
  on: UploadHandlers,
  makeXhr: () => XhrLike = () => new XMLHttpRequest(),
): void {
  uploadStarted();
  let open = true;
  const settle = (): boolean => {
    if (!open) return false;
    open = false;
    uploadFinished();
    return true;
  };
  queueUpload(
    (answered) => {
      const xhr = makeXhr();
      const finish = (outcome: UploadOutcome): void => {
        if (!settle()) return;
        answered(outcome.ok);
        on.settled(outcome);
      };
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || event.total === 0) return;
        on.progress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      };
      xhr.onload = () => {
        finish(parseOutcome(xhr.status, xhr.responseText));
      };
      xhr.onerror =
        xhr.onabort =
        xhr.ontimeout =
          () => {
            finish({ ok: false, message: null });
          };
      const body = new FormData();
      body.set("field", request.fieldKey);
      body.set("_locale", request.locale);
      body.set("file", request.file, "upload");
      xhr.open("POST", `/f/${encodeURIComponent(request.slug)}/files`);
      xhr.send(body);
    },
    // A new server render dropped it before it left: it is no longer in flight.
    () => {
      settle();
    },
  );
}

type Send = (url: string, init: { method: string }) => Promise<Pick<Response, "ok" | "status">>;

/** Removes a staged file. A 404 means it is already gone; a server error or no network fails. */
export async function removeFile(
  slug: string,
  id: string,
  send: Send = (url, init) => fetch(url, init),
): Promise<"gone" | "failed"> {
  try {
    const response = await send(`/f/${encodeURIComponent(slug)}/files/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return response.ok || response.status === 404 ? "gone" : "failed";
  } catch {
    return "failed";
  }
}
