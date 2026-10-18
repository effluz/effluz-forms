import type { DefinitionsDeps } from "@/modules/definitions/application";
import type { AuditLog, AuditLogReader } from "@/modules/identity/application";
import type { MediaDeps } from "@/modules/media/application";
import type { SubmissionsDeps } from "@/modules/submissions/application";
import type { Clock } from "@/shared/application/ports/clock";
import type { IdGenerator } from "@/shared/application/ports/id-generator";
import type { JobAdmin } from "@/shared/application/ports/job-admin";
import type { UnitOfWorkFactory } from "@/shared/application/ports/unit-of-work";
import type { FieldTypeRegistry } from "@/shared/domain/form-model";
import type { EditRepository } from "./ports/edit-repository";
import type { ReviewQueries } from "./ports/review-queries";
import type { StaffPhotoRepository } from "./ports/staff-photo-repository";
import type { StoryRepository } from "./ports/story-repository";
import type { ZipWriter } from "./ports/zip-writer";

/** Everything the review use cases need, wired at the composition root. */
export interface ReviewDeps {
  definitions: DefinitionsDeps;
  submissions: SubmissionsDeps;
  media: MediaDeps;
  stories: StoryRepository;
  staffPhotos: StaffPhotoRepository;
  edits: EditRepository;
  queries: ReviewQueries;
  jobs: JobAdmin;
  audit: AuditLog;
  auditReader: AuditLogReader;
  zip: ZipWriter;
  uow: UnitOfWorkFactory;
  clock: Clock;
  ids: IdGenerator;
  registry: FieldTypeRegistry;
  /** The post plan's calendar, PLAN_TIME_ZONE in production. */
  planTimeZone: string;
}
