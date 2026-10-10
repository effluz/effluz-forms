import type { z } from "zod";
import type { Languages, Locale } from "@/shared/domain/localized-text";
import type { IssueParams, ValidationCode } from "./issues";
import type { OperatorId } from "./operators";
import type { RuleId } from "./rules";

export const fieldTypeIds = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
  "date",
  "single_choice",
  "multiple_choice",
  "checkbox",
  "consent",
  "file_upload",
  "section",
] as const;
export type FieldTypeId = (typeof fieldTypeIds)[number];

/** A type's own check result: a bare code, or a code with message parameters. */
export type ValidationOutcome = ValidationCode | { code: ValidationCode; params: IssueParams };

export interface FieldTypeFixtures<S, A> {
  settings: S[];
  validAnswers: A[];
  invalidAnswers: unknown[];
  emptyAnswer?: A;
  /** Well-shaped answers over the type's own limit, validated with the first settings fixture. */
  overLimitAnswers?: A[];
}

export interface FieldTypeDefinition<S = unknown, A = unknown> {
  id: FieldTypeId;
  isInput: boolean;
  collectsPersonalData: boolean;
  settingsSchema: z.ZodType<S>;
  answerSchema: z.ZodType<A>;
  allowedRules: readonly RuleId[];
  allowedOperators: readonly OperatorId[];
  /** The declared hard length cap the type's own validate enforces, read by publish checks. */
  maxLength?: number;
  normalize(answer: A, settings: S): A;
  /** Limit outcomes (`max_*`, `*_max`) carry their bound as `params.n`. */
  validate(answer: A, settings: S): ValidationOutcome[];
  isEmpty(answer: A): boolean;
  exportHeaders(label: string): string[];
  exportCells(answer: A | undefined, settings: S, locale: Locale, languages: Languages): string[];
  fixtures: FieldTypeFixtures<S, A>;
}

export function defineFieldType<S, A>(def: FieldTypeDefinition<S, A>): FieldTypeDefinition<S, A> {
  return Object.freeze(def);
}

/** Loosens the generics for storage in a heterogeneous registry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFieldType = FieldTypeDefinition<any, any>;

export const normalizeText = (s: string): string => s.normalize("NFC").trim();
