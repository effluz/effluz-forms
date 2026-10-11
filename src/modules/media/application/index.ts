/** Public API of the media module. Other modules and the app import only this. */
export type { MediaKind, MediaStatus, MediaRecord, StagedFile } from "../domain/media";
export { MEDIA_KINDS, extensionFor } from "../domain/media";
export { fieldSlug, uniqueFieldSlugs, durableKey } from "../domain/keys";

export type { MediaDeps } from "./deps";
export type { MediaStorage, StagingStorage } from "./ports/media-storage";
export type { ContentSniffer } from "./ports/content-sniffer";
export type { ImageEncoder, EncodedImage } from "./ports/image-encoder";
export type { MediaRepository } from "./ports/media-repository";
export type { StageFileInput, StageFileResult, StageRefusal } from "./stage-file";
export type { AttachedFile } from "./attach";

export { stageFile } from "./stage-file";
export { attachToSubmission } from "./attach";
export { discardStaged, discardRecordFiles } from "./discard";
export { MEDIA_JOB_TYPES } from "./job-types";
