import type { ValidationIssue } from "@/shared/domain/form-model";
import type { Locale } from "@/shared/domain/localized-text";
import type { RawValues, RefusedFile } from "../domain/in-progress";

/** What the `effluz_fill_state` cookie says about the visitor's fill. See specs/ui-ux/renderer.md, "Navigation and state". */
export type FillState =
  | { kind: "none" }
  | { kind: "record"; id: string }
  | { kind: "done"; submitToken: string }
  | { kind: "decoy"; reference: string };

/** Why the public link shows no form. */
export type Gate = "not_found" | "closed" | "not_open_yet";

export type PageAction =
  | { kind: "next" }
  | { kind: "back" }
  | { kind: "submit" }
  | { kind: "language"; locale: Locale }
  | { kind: "remove"; fileId: string };

/** A file part of a page post, before any check. */
export interface IncomingFile {
  fieldKey: string;
  name: string;
  bytes: Uint8Array;
}

/** One decoded page post. See specs/use-cases/fill-and-submit-form.md. */
export interface PagePost {
  pageKey: string;
  action: PageAction;
  answers: Record<string, unknown>;
  decodeIssues: ValidationIssue[];
  raw: RawValues;
  incoming: IncomingFile[];
  renderedAt: Date | null;
  honeypot: string;
  submitToken: string | null;
  acceptLanguage: string | null;
  state: FillState;
}

/** Every outcome of a post ends in a redirect (Task 28). */
export type PostOutcome =
  /** Redirect to the page. */
  | { kind: "show"; recordId: string }
  /**
   * Redirect to the page with `?refused=<at>`, the files in the state cookie.
   * `page` is the position `n` of the page the record shows, so the page can
   * ignore a cookie written for another page.
   */
  | {
      kind: "refused";
      recordId: string;
      locale: Locale;
      page: number;
      refusedFiles: RefusedFile[];
    }
  | { kind: "submitted"; submitToken: string }
  | { kind: "decoy"; reference: string }
  | { kind: "expired" }
  | { kind: "gate"; state: Gate };
