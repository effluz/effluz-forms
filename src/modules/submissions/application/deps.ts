import type { DefinitionsDeps } from "@/modules/definitions/application";
import type { MediaDeps } from "@/modules/media/application";
import type { Clock } from "@/shared/application/ports/clock";
import type { IdGenerator } from "@/shared/application/ports/id-generator";
import type { JobQueue } from "@/shared/application/ports/job-queue";
import type { Logger } from "@/shared/application/ports/logger";
import type { UnitOfWorkFactory } from "@/shared/application/ports/unit-of-work";
import type { FieldTypeRegistry } from "@/shared/domain/form-model";
import type { InProgressRepository } from "./ports/in-progress-repository";
import type { SubmissionRepository } from "./ports/submission-repository";
import type { VersionCache } from "./version-cache";

/** Everything the submissions use cases need, wired at the composition root. */
export interface SubmissionsDeps {
  definitions: DefinitionsDeps;
  media: MediaDeps;
  inProgress: InProgressRepository;
  submissions: SubmissionRepository;
  queue: JobQueue;
  uow: UnitOfWorkFactory;
  clock: Clock;
  ids: IdGenerator;
  registry: FieldTypeRegistry;
  logger: Logger;
  versions: VersionCache;
  /** Uniform in [0, 1); injected so decoy references are testable. */
  random: () => number;
}
