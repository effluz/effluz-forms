// The only import surface other modules may use.
export { buildDefaultRegistry, operatorsFor } from "../domain/field-types";
export type { FieldTypeRegistry } from "../domain/registry";
export { UnknownFieldTypeError } from "../domain/registry";
export type { FieldTypeDefinition, FieldTypeId } from "../domain/field-type";
export { fieldTypeIds } from "../domain/field-type";
export { LIMITS } from "../domain/limits";
export { keySchema, asKey } from "../domain/keys";
export type { Key } from "../domain/keys";
export type { ValidationIssue, ValidationCode, PublishIssue, PublishCode } from "../domain/issues";
export { validationCodes, publishCodes } from "../domain/issues";
export { OPERATORS, operatorSchema } from "../domain/operators";
export type { OperatorId } from "../domain/operators";
export { conditionSchema, evaluateCondition, referencedKeys } from "../domain/condition";
export type { Condition, Clause } from "../domain/condition";
export { ruleSchema, PATTERN_MAX_INPUT } from "../domain/rules";
export type { Rule, RuleId } from "../domain/rules";
export { versionSchema, parseDraft, inputFields, fieldIndex } from "../domain/version";
export type { Version, Page, Field, ParseIssue, ParseResult } from "../domain/version";
export { evaluateVisibility } from "../domain/visibility";
export type { Visibility } from "../domain/visibility";
export { validateSubmission, isAbsent } from "../domain/submission";
export type { SubmissionContext, SubmissionResult } from "../domain/submission";
export {
  checkDefinition,
  validateForPublish,
  parseVersion,
  collectsPersonalData,
} from "../domain/publish";
export type { PublishContext } from "../domain/publish";
export { exportColumns, exportRow } from "../domain/export";
export type { ExportColumn } from "../domain/export";
export { consentTextVersion } from "../domain/consent-text";
export { consentItems, isConsentChecklistComplete } from "../domain/field-types/consent";
export type { ConsentItem } from "../domain/field-types/consent";
export { EMAIL_MAX_LENGTH } from "../domain/field-types/email";
export { effectiveDisplay } from "../domain/field-types/single-choice";
export { mediaIdSchema } from "../domain/field-types/file-upload";
