/**
 * Public API of the submissions module. `src/app` and `review` import it; no
 * other module depends on submissions. Later tasks add their use cases here.
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
export type { Curation, CurationStatus, StoredSubmission, Submission } from "../domain/submission";
export { CURATION_STATUSES } from "../domain/submission";

export { VersionCache } from "./version-cache";
export { postContext } from "./post-context";
export { viewForm } from "./view-form";
export { savePage } from "./save-page";
export { checkField } from "./check-field";
export { uploadFile, removeFile } from "./upload-file";
export { submitForm } from "./submit-form";
export { expireInProgress } from "./expire";
export { sweepStaging } from "./sweep-staging";
export {
  deleteSubmission,
  findSubmission,
  findSubmissionByReference,
  lockSubmission,
  writeCuration,
} from "./review-access";
export type { UploadOutcome, UploadRefusal } from "./upload-file";
export { HONEYPOT_FIELD, MIN_FILL_MS } from "../domain/protection";
export { uploadFields } from "../domain/intake";
export { withFileAnswers } from "../domain/in-progress";
export { localeFor, pickLocale } from "../domain/locale";
