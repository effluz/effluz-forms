/**
 * Public API of the submissions module. Only `src/app` imports it; no module
 * depends on submissions. Later tasks add their use cases here.
 */
export type { SubmissionsDeps } from "./deps";
export type {
  FillState,
  Gate,
  PageAction,
  PagePost,
  PostOutcome,
  IncomingFile,
} from "./fill-state";
export type { OpenContext, PostContext } from "./post-context";
export type { PageView, ViewResult } from "./view-form";
export type { InProgressRepository } from "./ports/in-progress-repository";
export type { SubmissionRepository } from "./ports/submission-repository";
export type {
  InProgress,
  PendingPage,
  StagedUpload,
  RawValues,
  FileIssueCode,
  RefusedFile,
} from "../domain/in-progress";
export type { Submission } from "../domain/submission";

export { VersionCache } from "./version-cache";
export { postContext } from "./post-context";
export { viewForm } from "./view-form";
export { HONEYPOT_FIELD, MIN_FILL_MS } from "../domain/protection";
export { uploadFields } from "../domain/intake";
export { withFileAnswers } from "../domain/in-progress";
export { localeFor, pickLocale } from "../domain/locale";
