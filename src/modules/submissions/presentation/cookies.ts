import { z } from "zod";
import {
  LIMITS,
  type FieldTypeRegistry,
  type UploadLimits,
  type Version,
} from "@/shared/domain/form-model";
import { uploadFields, type FillState, type RefusedFile } from "../application";
import type { FillPostState, RefusedFileEntry } from "./page-form-state";

/*
 * The renderer's two cookies: `effluz_fill` names the fill, `effluz_fill_state`
 * carries a refused post's files to the page it redirects to. Values, flags and
 * limits are specs/system/security.md, "In-progress cookie".
 */

export const FILL_COOKIE = "effluz_fill";
export const FILL_COOKIE_MAX_AGE_SECONDS = 86_400;
export const FILL_STATE_COOKIE = "effluz_fill_state";
export const FILL_STATE_MAX_AGE_SECONDS = 600;

/** Below the 4 KB a browser keeps per cookie, with room for its attributes. */
const MAX_ENCODED_LENGTH = 3400;
const MAX_REFUSED_FILES = 10;
const MAX_NAME_LENGTH = 80;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFERENCE = /^[A-Z0-9]{2,6}-\d{4,}$/;

/** The path both cookies live on: the form's own link, encoded so a slug adds no attribute. */
export function fillCookiePath(slug: string): string {
  return `/f/${encodeURIComponent(slug)}`;
}

/** The cookie value of a fill state; null for `none`, which clears the cookie. */
export function encodeFillState(state: FillState): string | null {
  switch (state.kind) {
    case "none":
      return null;
    case "record":
      return state.id;
    case "done":
      return `done.${state.submitToken}`;
    case "decoy":
      return `decoy.${state.reference}`;
  }
}

/** The fill state a cookie value names; any value of none of the three shapes is `none`. */
export function parseFillState(value: string | null): FillState {
  if (value === null || value === "") return { kind: "none" };
  if (UUID.test(value)) return { kind: "record", id: value };
  if (value.startsWith("done.") && UUID.test(value.slice(5)))
    return { kind: "done", submitToken: value.slice(5) };
  if (value.startsWith("decoy.") && REFERENCE.test(value.slice(6)))
    return { kind: "decoy", reference: value.slice(6) };
  return { kind: "none" };
}

/** The options `cookies().set` takes for either cookie. */
export function fillCookieOptions(
  slug: string,
  secure: boolean,
  maxAge: number,
): { path: string; httpOnly: true; sameSite: "lax"; secure: boolean; maxAge: number } {
  return { path: fillCookiePath(slug), httpOnly: true, sameSite: "lax", secure, maxAge };
}

function setCookie(value: string, slug: string, secure: boolean, maxAge: number): string {
  const flags = `Path=${fillCookiePath(slug)}; HttpOnly; SameSite=Lax; Max-Age=${String(maxAge)}`;
  return `${FILL_COOKIE}=${value}; ${flags}${secure ? "; Secure" : ""}`;
}

/** A `Set-Cookie` value for the in-progress cookie; `none` clears it. */
export function fillCookie(slug: string, state: FillState, secure: boolean): string {
  const value = encodeFillState(state);
  return value === null
    ? clearedFillCookie(slug, secure)
    : setCookie(value, slug, secure, FILL_COOKIE_MAX_AGE_SECONDS);
}

/** A `Set-Cookie` value that removes the in-progress cookie. */
export function clearedFillCookie(slug: string, secure: boolean): string {
  return setCookie("", slug, secure, 0);
}

/** One cookie of a `Cookie` request header; an absent or empty one is null. */
export function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at === -1 || part.slice(0, at).trim() !== name) continue;
    const value = part.slice(at + 1).trim();
    return value === "" ? null : value;
  }
  return null;
}

/**
 * The refused files of a post as the state cookie keeps them, each with the cap that refused
 * it in `params.maxMb`: the field's own size for `file_too_large`, the per-submission size for
 * `submission_too_large`.
 */
export function refusedEntries(
  files: readonly RefusedFile[],
  version: Version,
  registry: FieldTypeRegistry,
): RefusedFileEntry[] {
  const limits = new Map<string, UploadLimits>(
    uploadFields(version, registry).map((u) => [u.field.key, u.limits]),
  );
  return files.map((file) => {
    const maxMb =
      file.code === "file_too_large"
        ? limits.get(file.fieldKey)?.maxSizeMb
        : file.code === "submission_too_large"
          ? LIMITS.submissionSizeMb
          : undefined;
    return {
      field: file.fieldKey,
      code: file.code,
      name: file.name,
      params: maxMb === undefined ? {} : { maxMb },
    };
  });
}

const stateSchema = z.object({
  at: z.number().int(),
  page: z.number().int().positive(),
  refusedFiles: z
    .array(
      z.object({
        field: z.string(),
        code: z.enum([
          "file_too_large",
          "file_wrong_type",
          "file_unreadable",
          "upload_failed",
          "submission_too_large",
        ]),
        name: z.string(),
        params: z.record(z.string(), z.number()),
      }),
    )
    .max(MAX_REFUSED_FILES),
});

const encode = (state: FillPostState): string =>
  Buffer.from(JSON.stringify(state)).toString("base64url");

/**
 * The state cookie's value: base64url JSON of at most ten files, names cut to 80 code points.
 * When that would not fit in a cookie, every name is dropped (the page then numbers them).
 */
export function encodeFillPostState(state: FillPostState): string {
  const refusedFiles = state.refusedFiles.slice(0, MAX_REFUSED_FILES).map((entry) => ({
    ...entry,
    name: Array.from(entry.name).slice(0, MAX_NAME_LENGTH).join(""),
  }));
  const full = encode({ ...state, refusedFiles });
  if (full.length <= MAX_ENCODED_LENGTH) return full;
  return encode({ ...state, refusedFiles: refusedFiles.map((entry) => ({ ...entry, name: "" })) });
}

/**
 * The state the cookie carries when it belongs to the post `refused` names, or null: for
 * another post, no cookie, or anything that does not read as a state.
 */
export function decodeFillPostState(
  raw: string | undefined,
  refused: string | null,
): FillPostState | null {
  if (raw === undefined || raw === "" || refused === null || refused === "") return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = stateSchema.safeParse(json);
  if (!parsed.success || String(parsed.data.at) !== refused) return null;
  return parsed.data;
}
