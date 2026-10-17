import type { Clock } from "@/shared/application/ports/clock";
import type { IdGenerator } from "@/shared/application/ports/id-generator";
import type { JobQueue } from "@/shared/application/ports/job-queue";
import type { UnitOfWorkFactory } from "@/shared/application/ports/unit-of-work";
import type { ContentSniffer } from "./ports/content-sniffer";
import type { ImageEncoder } from "./ports/image-encoder";
import type { MediaRepository } from "./ports/media-repository";
import type { MediaStorage, StagingStorage } from "./ports/media-storage";

/** Everything the media use cases need, wired at the composition root. */
export interface MediaDeps {
  staging: StagingStorage;
  durable: MediaStorage;
  sniffer: ContentSniffer;
  encoder: ImageEncoder;
  media: MediaRepository;
  queue: JobQueue;
  uow: UnitOfWorkFactory;
  ids: IdGenerator;
  clock: Clock;
}
