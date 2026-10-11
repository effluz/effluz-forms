// Entry point of the shared form model (ADR 0022). Import this path only; the files
// behind it are internal.
export { buildDefaultRegistry, fieldTypes, operatorsFor } from "./field-types";
export type { FieldTypeRegistry } from "./registry";
export { createRegistry, UnknownFieldTypeError } from "./registry";
export type {
  ExclusiveRole,
  FieldTypeDefinition,
  FieldTypeId,
  PublishIssueDraft,
  SettingsText,
  ValidationOutcome,
} from "./field-type";
export { defineFieldType, fieldTypeIds } from "./field-type";
export { LIMITS } from "./limits";
export { keySchema, asKey, newKey } from "./keys";
export type { Key, KeyPrefix } from "./keys";
export type { ValidationIssue, ValidationCode, PublishIssue, PublishCode } from "./issues";
export { validationCodes, publishCodes } from "./issues";
export { OPERATORS, operatorSchema } from "./operators";
export type { OperatorId } from "./operators";
export { conditionSchema, evaluateCondition, referencedKeys } from "./condition";
export type { Condition, Clause } from "./condition";
export { ruleSchema, graphemeLength } from "./rules";
export type { Rule, RuleId, RuleContext } from "./rules";
export { versionSchema, parseDraft, inputFields, fieldIndex, conditionOwners } from "./version";
export type { Version, Page, Field, ParseIssue, ParseResult, ConditionOwner } from "./version";
export { evaluateVisibility } from "./visibility";
export type { Visibility } from "./visibility";
export { validateSubmission, isAbsent } from "./submission";
export type { SubmissionContext, SubmissionResult } from "./submission";
export { checkDefinition, validateForPublish, parseVersion, collectsPersonalData } from "./publish";
export type { PublishContext } from "./publish";
export { exportColumns, exportRow } from "./export";
export type { ExportColumn } from "./export";
export { consentTextVersion } from "./consent-text";
export { consentItems, isConsentChecklistComplete } from "./field-types/consent";
export type { ConsentItem } from "./field-types/consent";
export { EMAIL_MAX_LENGTH } from "./field-types/email";
export { effectiveDisplay, DROPDOWN_MIN_OPTIONS } from "./field-types/single-choice";
export { optionSchema } from "./field-types/choice-shared";
export type { Option } from "./field-types/choice-shared";
export { mediaIdSchema } from "./field-types/file-upload";
