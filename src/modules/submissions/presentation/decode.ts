import type {
  Field,
  FieldTypeRegistry,
  ValidationIssue,
  Version,
} from "@/shared/domain/form-model";
import type { Locale } from "@/shared/domain/localized-text";
import type { RawValues } from "../domain/in-progress";
import { HONEYPOT_FIELD } from "../domain/protection";
import { type Decoded, type FieldInput, fieldRenderers } from "./fields";

/**
 * What a page post asks for. Structural twin of the application layer's `PageAction`, kept
 * here so presentation does not depend on the post context for one union.
 */
export type PageAction =
  | { kind: "next" }
  | { kind: "back" }
  | { kind: "submit" }
  | { kind: "language"; locale: Locale }
  | { kind: "remove"; fileId: string };

/** A file as posted; structural twin of the application layer's `IncomingFile`. */
export interface IncomingFile {
  fieldKey: string;
  name: string;
  bytes: Uint8Array;
}

/**
 * A page post read from the form: answers, control fields and files. The page's own fields
 * are `_page`, `_action`, `_rendered`, `_token` and the honeypot; none can be a field key.
 */
export interface DecodedPost {
  pageKey: string;
  action: PageAction;
  answers: Record<string, unknown>;
  decodeIssues: ValidationIssue[];
  raw: RawValues;
  incoming: IncomingFile[];
  renderedAt: Date | null;
  honeypot: string;
  submitToken: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The action a page post asked for, or null when it is not one the page offers. */
export function parseAction(value: string | null): PageAction | null {
  if (value === "next" || value === "back" || value === "submit") return { kind: value };
  if (value === "language:en" || value === "language:es") {
    return { kind: "language", locale: value.slice(9) as Locale };
  }
  if (value?.startsWith("remove:") && UUID.test(value.slice(7))) {
    return { kind: "remove", fileId: value.slice(7) };
  }
  return null;
}

/** A string entry of the form, or null for an absent one or a file. */
function str(entry: FormDataEntryValue | null): string | null {
  return typeof entry === "string" ? entry : null;
}

/** The form as a decoder reads it: strings only. */
export function formInput(form: FormData): FieldInput {
  return {
    get: (name) => str(form.get(name)),
    getAll: (name) =>
      form.getAll(name).filter((entry): entry is string => typeof entry === "string"),
  };
}

/** Runs one field's decoder over a posted form. */
export function decodeField(form: FormData, field: Field): Decoded {
  return fieldRenderers[field.type].decode(formInput(form), field);
}

/**
 * Reads a page post against the version it answers (specs/ui-ux/renderer.md, "Field
 * rendering"). Null when the page or the action is not one the version offers. Only the
 * page's own field keys are read, so Next's `$` fields and other pages' fields fall away.
 */
export async function decodePagePost(
  form: FormData,
  version: Version,
  registry: FieldTypeRegistry,
): Promise<DecodedPost | null> {
  const pageKey = str(form.get("_page"));
  const action = parseAction(str(form.get("_action")));
  const page = version.pages.find((p) => p.key === pageKey);
  if (!page || !action) return null;
  const answers: Record<string, unknown> = {};
  const decodeIssues: ValidationIssue[] = [];
  const raw: RawValues = {};
  const incoming: IncomingFile[] = [];
  const keys = new Set<string>(page.fields.map((f) => f.key));
  for (const [name, value] of form.entries()) {
    const owner = name.split(".")[0] ?? "";
    if (typeof value !== "string" || !keys.has(owner)) continue;
    const prev = raw[name];
    raw[name] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  for (const field of page.fields) {
    const def = registry.get(field.type);
    if (!def.isInput) continue;
    if (def.uploadLimits) {
      for (const entry of form.getAll(field.key)) {
        if (typeof entry !== "string") {
          incoming.push({
            fieldKey: field.key,
            name: entry.name,
            bytes: new Uint8Array(await entry.arrayBuffer()),
          });
        }
      }
      continue;
    }
    const decoded = decodeField(form, field);
    if (decoded.issue !== null) decodeIssues.push({ code: decoded.issue, field: field.key });
    else if (decoded.value !== undefined) answers[field.key] = decoded.value;
  }
  const rendered = str(form.get("_rendered"));
  const renderedAt = rendered === null ? null : new Date(rendered);
  const token = str(form.get("_token"));
  return {
    pageKey: page.key,
    action,
    answers,
    decodeIssues,
    raw,
    incoming,
    renderedAt: renderedAt && !Number.isNaN(renderedAt.getTime()) ? renderedAt : null,
    honeypot: str(form.get(HONEYPOT_FIELD)) ?? "",
    submitToken: token && UUID.test(token) ? token : null,
  };
}
