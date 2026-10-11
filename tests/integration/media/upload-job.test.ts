import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMediaUploadHandler, type MediaDeps } from "@/modules/media/application";
import { FileTypeSniffer } from "@/modules/media/infrastructure/file-type-sniffer";
import { LocalDiskStorage } from "@/modules/media/infrastructure/local-disk-storage";
import { PgMediaRepository } from "@/modules/media/infrastructure/pg-media-repository";
import { SharpImageEncoder } from "@/modules/media/infrastructure/sharp-image-encoder";
import { handlerContext } from "@/shared/application/testing/fakes";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

const ID = "33333333-3333-4333-8333-333333333333";
const DURABLE_KEY = "forms/s/HP-0001/01-photos.jpg";
const STAGING_REF = "in-progress/r/a.jpg";

describe("media.upload job against the local adapters", () => {
  const pool = testPool();
  let root: string;
  beforeEach(async () => {
    await truncateAll(pool);
    root = await mkdtemp(path.join(os.tmpdir(), "effluz-upload-job-"));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("moves a staged file to the durable directory and marks the row stored", async () => {
    const staging = new LocalDiskStorage(path.join(root, "staging"));
    const durable = new LocalDiskStorage(path.join(root, "durable"));
    const media = new PgMediaRepository(pool);
    const uow = new PgUnitOfWorkFactory(pool);
    const deps: MediaDeps = {
      staging,
      durable,
      sniffer: new FileTypeSniffer(),
      encoder: new SharpImageEncoder(),
      media,
      queue: new PgJobQueue(systemIdGenerator, systemClock),
      uow,
      ids: systemIdGenerator,
      clock: systemClock,
    };
    await staging.put(new Uint8Array([9]), STAGING_REF, "image/jpeg");
    const now = systemClock.now();
    await uow.run((u) =>
      media.insert(u, {
        id: ID,
        submissionId: "11111111-1111-4111-8111-111111111111",
        formId: "22222222-2222-4222-8222-222222222222",
        fieldKey: "photos",
        position: 1,
        kind: "image",
        status: "staged",
        contentType: "image/jpeg",
        size: 1,
        stagingRef: STAGING_REF,
        durableKey: DURABLE_KEY,
        providerRef: null,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await createMediaUploadHandler(deps)({ mediaId: ID }, handlerContext({ uow }));

    expect(await durable.read(DURABLE_KEY)).toEqual(new Uint8Array([9]));
    expect(await staging.exists(STAGING_REF)).toBe(false);
    expect(await media.findById(ID)).toMatchObject({ status: "stored", stagingRef: null });
  });
});
