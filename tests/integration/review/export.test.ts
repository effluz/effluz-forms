import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_QUERY,
  exportStories,
  type ExportLabels,
  type ReviewDeps,
} from "@/modules/review/application";
import { OWNER } from "@/modules/review/application/testing/fixtures";
import { storyVersion } from "@/modules/submissions/domain/testing/versions";
import { PgSubmissionRepository } from "@/modules/submissions/infrastructure/pg-submission-repository";
import type { Version } from "@/shared/domain/form-model";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "../submissions/factories";
import { pgReviewDeps } from "./wiring";

const ROWS = 1_200;
/** specs/ui-ux/manager.md, "Performance targets": an export of 10,000 rows starts within 2 s. */
const FIRST_ROWS_BUDGET_MS = 2_000;

const labels = (): ExportLabels => ({
  reference: "Referencia",
  status: "Estado",
  received: "Recibida (UTC)",
  version: "Versión",
  language: "Idioma",
  planned: "Fecha planificada",
  postLink: "Enlace de la publicación",
  files: "Rutas de archivos",
  staffPhotos: "Fotos agregadas",
  corrected: (label) => `${label} (corregida)`,
  statuses: { new: "Nueva", viewed: "Vista", edited: "Editada", published: "Publicada" },
});

describe("export in Postgres", () => {
  const pool = testPool();
  let dir: string;
  beforeEach(async () => {
    await truncateAll(pool);
    dir = await mkdtemp(path.join(os.tmpdir(), "effluz-export-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const deps = (): ReviewDeps =>
    pgReviewDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });

  /** `count` synthetic submissions, received one second apart; references oldest first. */
  async function seedMany(count: number): Promise<{ formId: string; references: string[] }> {
    const { formId, versionId } = await seedPublishedForm(pool);
    const repository = new PgSubmissionRepository(pool);
    const start = Date.parse("2026-10-01T12:00:00.000Z");
    const references: string[] = [];
    await new PgUnitOfWorkFactory(pool).run(async (uow) => {
      for (let i = 1; i <= count; i += 1) {
        const reference = `ST-${String(i).padStart(4, "0")}`;
        const receivedAt = new Date(start + i * 1000);
        references.push(reference);
        await repository.insert(uow, {
          id: randomUUID(),
          formId,
          versionId,
          locale: "es",
          answers: { f_name: `Persona Prueba ${String(i)}` },
          consent: {
            fieldKey: "f_consent",
            textVersion: "0123456789abcdef",
            acceptedAt: receivedAt,
          },
          receivedAt,
          reference,
          submitToken: randomUUID(),
        });
      }
    });
    return { formId, references };
  }

  /** Reads a CSV body to the end, as text without the BOM, split into lines. */
  async function readLines(body: ReadableStream<Uint8Array>): Promise<string[]> {
    const text = await new Response(body).text();
    const lines = text.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines.pop()).toBe("");
    return lines;
  }

  it("streams 1,200 rows in batches", async () => {
    const { formId, references } = await seedMany(ROWS);
    const real = deps();
    const batchSizes: number[] = [];
    const exportBatch = real.queries.exportBatch.bind(real.queries);
    real.queries.exportBatch = async (...args) => {
      const batch = await exportBatch(...args);
      batchSizes.push(batch.length);
      return batch;
    };

    const result = await exportStories(real, OWNER, {
      formId,
      query: EMPTY_QUERY,
      options: { versions: "all", text: "original", paths: true },
      labels,
    });
    if (!result.ok) throw new Error(`expected an export, got ${result.code}`);
    expect(result.count).toBe(ROWS);
    // Nothing is read before the body is.
    expect(batchSizes).toEqual([]);

    const reader = result.body.getReader();
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    let chunks = 0;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += 1;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();

    expect(batchSizes).toEqual([500, 500, 200]);
    expect(chunks).toBeGreaterThan(3);
    const lines = text.slice(1).split("\r\n");
    expect(lines.pop()).toBe("");
    expect(lines).toHaveLength(ROWS + 1);
    expect(lines.slice(1).map((line) => line.split(",")[0])).toEqual([...references].reverse());
  });

  it("guards a header label that starts like a formula", async () => {
    const document = storyVersion();
    const evil: Version = {
      ...document,
      pages: document.pages.map((page) => ({
        ...page,
        fields: page.fields.map((field) =>
          field.key === "f_name" ? { ...field, label: { en: "=Name", es: "=Nombre" } } : field,
        ),
      })),
    };
    const { formId } = await seedPublishedForm(pool, evil);

    const result = await exportStories(deps(), OWNER, {
      formId,
      query: EMPTY_QUERY,
      options: { versions: "all", text: "original", paths: false },
      labels,
    });
    if (!result.ok) throw new Error(`expected an export, got ${result.code}`);

    const [header] = await readLines(result.body);
    expect(header?.split(",")).toContain("'=Nombre");
    expect(header).not.toMatch(/(^|,)=Nombre/);
  });

  it(
    "sends the first rows of a 10,000-row export within 2 seconds",
    { timeout: 60_000 },
    async () => {
      const { formId, versionId } = await seedPublishedForm(pool);
      // Synthetic rows only: "Prueba <n>" names, one a minute.
      await pool.query(
        `insert into submission (id, form_id, form_version_id, locale, answers, received_at,
         reference, submit_token)
       select gen_random_uuid(), $1, $2, 'es', jsonb_build_object('f_name', 'Prueba ' || n),
              timestamptz '2026-10-18 15:00:00+00' - n * interval '1 minute',
              'BT-' || lpad(n::text, 5, '0'), gen_random_uuid()
         from generate_series(1, 10000) as n`,
        [formId, versionId],
      );
      await pool.query("analyze submission");

      const started = performance.now();
      const result = await exportStories(deps(), OWNER, {
        formId,
        query: EMPTY_QUERY,
        options: { versions: "all", text: "both", paths: true },
        labels,
      });
      if (!result.ok) throw new Error(`expected an export, got ${result.code}`);
      const reader = result.body.getReader();
      const header = await reader.read();
      const rows = await reader.read();
      const elapsed = performance.now() - started;
      await reader.cancel();

      expect(result.count).toBe(10_000);
      expect(header.done).toBe(false);
      expect(rows.done).toBe(false);
      expect(new TextDecoder().decode(rows.value)).toMatch(/^BT-00001,/);
      expect(elapsed).toBeLessThan(FIRST_ROWS_BUDGET_MS);
    },
  );
});
