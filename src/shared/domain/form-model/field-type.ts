import type { z } from "zod";
import type { Languages, Locale, LocalizedText } from "@/shared/domain/localized-text";
import type { IssueParams, PublishCode, ValidationCode } from "./issues";
import type { OperatorId } from "./operators";
import type { Rule, RuleId } from "./rules";

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

/** A staff-authored text inside a field's settings that publish validation checks. */
export interface SettingsText {
  /** Relative to the field's settings, e.g. "title" or "options/2/label". */
  path: string;
  /** Undefined is skipped for an optional text and counts as blank for a required one. */
  text: LocalizedText | undefined;
  /**
   * Reported when the text is blank in every required language. Null marks an
   * optional text: it is skipped when absent, and only missing_translation
   * applies when it is partially filled.
   */
  blankCode: PublishCode | null;
}

/** A publish issue from a type's own checks; the path is relative to the field. */
export interface PublishIssueDraft {
  code: PublishCode;
  path: string;
  params?: IssueParams;
}

/** A role at most one field per form may hold; a second holder reports `code` at "pages". */
export interface ExclusiveRole {
  role: string;
  code: PublishCode;
  params?: IssueParams;
}

/** Which fields take files, and their limits: a type hook, so no consumer tests a type id. */
export interface UploadLimits {
  kinds: readonly ("image" | "video")[];
  maxFiles: number;
  maxSizeMb: number;
}

/** What a form's publish context tells a type's own publish checks. */
export interface PublishChecksContext {
  /** The form uses the post plan (ADR 0029). */
  postPlan: boolean;
}

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
  /**
   * The smallest settings `settingsSchema` accepts, for a newly added field.
   * Publish validation, not parsing, reports what staff still have to fill.
   */
  defaultSettings(ids: { newId(): string }): NoInfer<S>;
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

  // Optional hooks, read generically by publish and submission validation (ADR 0016).
  /** Staff-authored texts inside settings that publish validation must check. */
  localizedSettingsTexts?(settings: S): SettingsText[];
  /** Type-specific publish checks beyond texts. */
  publishChecks?(
    field: { required: boolean; validation: readonly Rule[] },
    settings: S,
    ctx: PublishChecksContext,
  ): PublishIssueDraft[];
  /** The consent checklist items the settings cover; only consent types declare it. */
  consentCoverage?(settings: S): readonly string[];
  /**
   * How review treats the answer: `curatable` (staff keep a corrected copy), `searchable` (the
   * list's search reads it), `label` (the first such answer names the story in lists). Each
   * implies a string answer.
   */
  reviewTraits?: { curatable?: true; searchable?: true; label?: true };
  /** Form-wide exclusivity: each returned role may appear at most once per form. */
  exclusiveRoles?(settings: S): ExclusiveRole[];
  /** The answer is demanded even when the field is not marked required. */
  alwaysRequired?: true;
  /**
   * Code for a demanded answer that is absent or empty, and for a malformed
   * answer of an always-required type. Defaults: "required", "invalid_shape".
   */
  requiredCode?: ValidationCode;
  /** Visibility conditions never hide this field; publish rejects any condition on it. */
  neverHidden?: true;
  /** Extracts the consent record from a normalized answer. */
  consentRecord?(answer: A): { textVersion: string };
  /** The field takes files: accepted kinds and limits, read by the renderer and the intake. */
  uploadLimits?(settings: S): UploadLimits;
}

export function defineFieldType<S, A>(def: FieldTypeDefinition<S, A>): FieldTypeDefinition<S, A> {
  return Object.freeze(def);
}

/** Loosens the generics for storage in a heterogeneous registry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFieldType = FieldTypeDefinition<any, any>;

export const normalizeText = (s: string): string => s.normalize("NFC").trim();
