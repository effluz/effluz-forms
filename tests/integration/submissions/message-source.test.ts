import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateSettings } from "@/modules/definitions/application";
import { VersionCache } from "@/modules/submissions/application";
import { registry, storyVersion } from "@/modules/submissions/domain/testing/versions";
import { SubmissionMessageSource } from "@/modules/submissions/infrastructure/message-source";
import { PgSubmissionRepository } from "@/modules/submissions/infrastructure/pg-submission-repository";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "./factories";
import { pgSubmissionsDeps } from "./wiring";

describe("SubmissionMessageSource", () => {
  const pool = testPool();
  let dir: string;
  // Building messages never touches media: the storage directory stays empty.
  const dirs = () => ({ staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });
  beforeEach(async () => {
    await truncateAll(pool);
    dir = await mkdtemp(path.join(os.tmpdir(), "effluz-messages-"));
  });
  afterEach(async () => {
    expect(await readdir(dir)).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it("builds both messages from the stored submission at run time", async () => {
    const { formId, versionId } = await seedPublishedForm(pool);
    const deps = pgSubmissionsDeps(pool, dirs());
    const form = await deps.definitions.forms.findById(formId);
    if (!form) throw new Error("no form");
    const updated = await updateSettings(
      deps.definitions,
      { email: "editor@example.com", ip: "203.0.113.7" },
      {
        formId,
        settings: {
          ...form.settings,
          notificationRecipients: ["stories@example.com"],
          timezone: "America/Panama",
        },
      },
    );
    expect(updated.ok).toBe(true);
    const repo = new PgSubmissionRepository(pool);
    const id = randomUUID();
    await deps.uow.run((u) =>
      repo.insert(u, {
        id,
        formId,
        versionId,
        locale: "es",
        answers: { f_name: "Ana Prueba", f_email: "family@example.com" },
        consent: null,
        receivedAt: new Date("2026-10-10T14:00:00Z"),
        reference: "SF-0001",
        submitToken: randomUUID(),
      }),
    );
    const source = new SubmissionMessageSource({
      submissions: repo,
      definitions: deps.definitions,
      versions: new VersionCache(),
      registry,
      publicBaseUrl: "https://forms.example.com",
      privacyContact: "privacy@example.com",
    });
    expect(await source.submitterConfirmation(id)).toEqual({
      to: "family@example.com",
      data: {
        locale: "es",
        formTitle: "Historias",
        subject: "Gracias",
        body: "Lo recibimos.",
        receivedOn: "10 de octubre de 2026",
        reference: "SF-0001",
        retentionMonths: 12,
        contact: "privacy@example.com",
      },
    });
    expect(await source.staffNotification(id)).toEqual({
      to: ["stories@example.com"],
      data: {
        formTitle: "Sample form",
        reference: "SF-0001",
        receivedAt: "2026-10-10 09:00 America/Panama, 14:00 UTC",
        link: `https://forms.example.com/admin/forms/${formId}/submissions/SF-0001`,
      },
    });
    expect(await source.submitterConfirmation(randomUUID())).toBeNull();
  });

  it("links the staff notification to the story page", async () => {
    const { formId, versionId } = await seedPublishedForm(pool, storyVersion(), {
      notificationRecipients: ["stories@example.com"],
    });
    const deps = pgSubmissionsDeps(pool, dirs());
    const repo = new PgSubmissionRepository(pool);
    const id = randomUUID();
    await deps.uow.run((u) =>
      repo.insert(u, {
        id,
        formId,
        versionId,
        locale: "en",
        answers: { f_name: "Ana Prueba" },
        consent: null,
        receivedAt: new Date("2026-10-10T14:00:00Z"),
        reference: "SF-0003",
        submitToken: randomUUID(),
      }),
    );
    const source = new SubmissionMessageSource({
      submissions: repo,
      definitions: deps.definitions,
      versions: new VersionCache(),
      registry,
      publicBaseUrl: "https://forms.example.com",
      privacyContact: "privacy@example.com",
    });
    const message = await source.staffNotification(id);
    expect(message?.data.link).toBe(
      `https://forms.example.com/admin/forms/${formId}/submissions/SF-0003`,
    );

    // A prefix staff typed with characters a path segment cannot hold as they are.
    const odd = randomUUID();
    await deps.uow.run((u) =>
      repo.insert(u, {
        id: odd,
        formId,
        versionId,
        locale: "en",
        answers: { f_name: "Ana Prueba" },
        consent: null,
        receivedAt: new Date("2026-10-10T15:00:00Z"),
        reference: "SÉ#-0004",
        submitToken: randomUUID(),
      }),
    );
    expect((await source.staffNotification(odd))?.data.link).toBe(
      `https://forms.example.com/admin/forms/${formId}/submissions/S%C3%89%23-0004`,
    );
  });

  it("returns null when there is nothing to send", async () => {
    const repo = new PgSubmissionRepository(pool);
    const deps = pgSubmissionsDeps(pool, dirs());
    const source = new SubmissionMessageSource({
      submissions: repo,
      definitions: deps.definitions,
      versions: new VersionCache(),
      registry,
      publicBaseUrl: "https://forms.example.com",
      privacyContact: "privacy@example.com",
    });
    const stored = async (
      seeded: { formId: string; versionId: string },
      answers: Record<string, unknown>,
    ): Promise<string> => {
      const id = randomUUID();
      await deps.uow.run((u) =>
        repo.insert(u, {
          id,
          formId: seeded.formId,
          versionId: seeded.versionId,
          locale: "en",
          answers,
          consent: null,
          receivedAt: new Date("2026-10-10T14:00:00Z"),
          reference: "SF-0002",
          submitToken: randomUUID(),
        }),
      );
      return id;
    };

    // No address answered, and no recipients in the settings.
    const plain = await stored(await seedPublishedForm(pool), { f_name: "Ana Prueba" });
    expect(await source.submitterConfirmation(plain)).toBeNull();
    expect(await source.staffNotification(plain)).toBeNull();

    // A version without a confirmation email, and a daily cadence.
    const { confirmation } = storyVersion();
    const quiet = await stored(
      await seedPublishedForm(
        pool,
        { ...storyVersion(), confirmation: { screen: confirmation.screen } },
        { notificationRecipients: ["stories@example.com"], notificationCadence: "daily" },
      ),
      { f_name: "Ana Prueba", f_email: "family@example.com" },
    );
    expect(await source.submitterConfirmation(quiet)).toBeNull();
    expect(await source.staffNotification(quiet)).toBeNull();

    // The submission is gone.
    expect(await source.staffNotification(randomUUID())).toBeNull();
  });
});
