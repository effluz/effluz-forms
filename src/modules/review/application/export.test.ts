import { describe, expect, it } from "vitest";
import { asKey, type Field } from "@/shared/domain/form-model";
import { reviewAuditActions } from "../domain/audit";
import { EMPTY_QUERY, type ListQuery } from "../domain/list-query";
import { exportLocale, exportStories, type ExportLabels, type ExportOptions } from "./export";
import type { ExportSource } from "./ports/review-queries";
import { OWNER, seedStory } from "./testing/fixtures";
import { makeReviewDeps, type FakeReviewDeps } from "./testing/fakes";

type Seeded = Awaited<ReturnType<typeof seedStory>>;

/** The Spanish rows of `ex.col_*`, `ex.corrected_suffix` and `sub.status_*` in manager.md. */
const spanish: ExportLabels = {
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
};
const english: ExportLabels = {
  ...spanish,
  reference: "Reference",
  corrected: (label) => `${label} (corrected)`,
};
const labels = (locale: "en" | "es") => (locale === "es" ? spanish : english);

const FIXED =
  "Referencia,Estado,Recibida (UTC),Versión,Idioma,Fecha planificada,Enlace de la publicación";
const FIELDS =
  "Nombre,Correo,¿Bebé?,Fotos (count),Fotos (files),Consentimiento,Consentimiento (text version)";

const reviewAudit = (deps: FakeReviewDeps) =>
  deps.audit.entries
    .filter((e) => (reviewAuditActions as readonly string[]).includes(e.entry.action))
    .map((e) => e.entry);

function versionIdOf(deps: FakeReviewDeps, story: Seeded): string {
  const id = deps.definitions.store.forms.get(story.formId)?.currentVersionId;
  if (id == null) throw new Error("the story form has no current version");
  return id;
}

function source(
  deps: FakeReviewDeps,
  story: Seeded,
  over: Partial<ExportSource> = {},
): ExportSource {
  const [p1, p2] = story.photoIds;
  return {
    submissionId: story.submissionId,
    reference: "ST-0001",
    receivedAt: new Date("2026-10-18T15:00:00.000Z"),
    versionId: versionIdOf(deps, story),
    locale: "es",
    status: "edited",
    answers: {
      f_name: "Ana Prueba",
      f_email: "ana@example.com",
      f_baby: "yes_opt",
      f_photos: [p1, p2],
    },
    curatedAnswers: { f_name: "Ana Corregida" },
    postUrl: null,
    plannedOn: "2026-10-20",
    senderFiles: [
      { fieldKey: "f_photos", key: "forms/story-form/ST-0001/01-photos.jpg" },
      { fieldKey: "f_photos", key: "forms/story-form/ST-0001/02-photos.jpg" },
    ],
    staffKeys: ["forms/story-form/ST-0001/staff-01-0a1b2c3d.jpg"],
    ...over,
  };
}

const ORIGINAL: ExportOptions = { versions: "filter", text: "original", paths: false };

async function run(
  deps: FakeReviewDeps,
  story: Seeded,
  options: ExportOptions = ORIGINAL,
  query: ListQuery = EMPTY_QUERY,
) {
  return exportStories(deps, OWNER, { formId: story.formId, query, options, labels });
}

/** A minimal RFC 4180 reader: rows of cells, the BOM already gone. */
function parseCsv(textValue: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < textValue.length; i += 1) {
    const c = textValue.charAt(i);
    if (quoted) {
      if (c === '"' && textValue.charAt(i + 1) === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && textValue.charAt(i + 1) === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else cell += c;
  }
  return rows;
}

async function csvOf(result: Awaited<ReturnType<typeof run>>) {
  if (!result.ok) throw new Error(`expected an export, got ${result.code}`);
  const bytes = new Uint8Array(await new Response(result.body).arrayBuffer());
  const textValue = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  return { bytes, text: textValue, rows: parseCsv(textValue.slice(1)) };
}

describe("exportStories", () => {
  it("writes a BOM, the fixed headers and one row per submission", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    deps.queries.countResult = 2;
    deps.queries.exportBatches = [
      [source(deps, story), source(deps, story, { reference: "ST-0002", status: "new" })],
    ];

    const csv = await csvOf(await run(deps, story));

    expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.text.slice(1).split("\r\n")[0]).toBe(`${FIXED},${FIELDS}`);
    expect(csv.rows).toHaveLength(3);
    const [, first, second] = csv.rows;
    expect(first?.slice(0, 7)).toEqual([
      "ST-0001",
      "Editada",
      "2026-10-18T15:00:00Z",
      "1",
      "es",
      "2026-10-20",
      "",
    ]);
    expect(first?.slice(7, 10)).toEqual(["Ana Prueba", "ana@example.com", "Sí"]);
    expect(second?.slice(0, 2)).toEqual(["ST-0002", "Nueva"]);
  });

  it("adds corrected columns when asked", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const rowsWith = async (textOption: ExportOptions["text"]) => {
      deps.queries.exportBatches = [
        [source(deps, story), source(deps, story, { reference: "ST-0002", curatedAnswers: {} })],
      ];
      const { rows } = await csvOf(await run(deps, story, { ...ORIGINAL, text: textOption }));
      return rows.map((r) => r.slice(7, 9));
    };

    expect(await rowsWith("both")).toEqual([
      ["Nombre", "Nombre (corregida)"],
      ["Ana Prueba", "Ana Corregida"],
      ["Ana Prueba", ""],
    ]);
    expect(await rowsWith("corrected")).toEqual([
      ["Nombre", "Correo"],
      ["Ana Corregida", "ana@example.com"],
      ["Ana Prueba", "ana@example.com"],
    ]);
    expect(await rowsWith("original")).toEqual([
      ["Nombre", "Correo"],
      ["Ana Prueba", "ana@example.com"],
      ["Ana Prueba", "ana@example.com"],
    ]);
  });

  it("adds file path columns when asked", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    // A second file field after the photos: the read model lists `f_docs` first by key.
    const versionId = versionIdOf(deps, story);
    const stored = deps.definitions.store.versions.get(versionId);
    if (!stored) throw new Error("no stored version");
    const withDocs = (field: Field): Field[] =>
      field.key === "f_photos"
        ? [field, { ...field, key: asKey("f_docs"), label: { en: "Documents", es: "Documentos" } }]
        : [field];
    deps.definitions.store.versions.set(versionId, {
      ...stored,
      document: {
        ...stored.document,
        pages: stored.document.pages.map((p) => ({ ...p, fields: p.fields.flatMap(withDocs) })),
      },
    });
    deps.queries.exportBatches = [
      [
        source(deps, story, {
          senderFiles: [
            { fieldKey: "f_docs", key: "forms/story-form/ST-0001/03-documentos.jpg" },
            { fieldKey: "f_photos", key: "forms/story-form/ST-0001/01-photos.jpg" },
            { fieldKey: "f_photos", key: "forms/story-form/ST-0001/02-photos.jpg" },
          ],
        }),
      ],
    ];

    const { rows } = await csvOf(await run(deps, story, { ...ORIGINAL, paths: true }));

    expect(rows[0]?.slice(-2)).toEqual(["Rutas de archivos", "Fotos agregadas"]);
    expect(rows[1]?.slice(-2)).toEqual([
      "forms/story-form/ST-0001/01-photos.jpg; forms/story-form/ST-0001/02-photos.jpg; forms/story-form/ST-0001/03-documentos.jpg",
      "forms/story-form/ST-0001/staff-01-0a1b2c3d.jpg",
    ]);
  });

  it("exports a formula-looking answer as text", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const row = source(deps, story);
    deps.queries.exportBatches = [
      [{ ...row, answers: { ...row.answers, f_name: '=HYPERLINK("x")' } }],
    ];

    const csv = await csvOf(await run(deps, story));

    expect(csv.text).toContain(`,"'=HYPERLINK(""x"")",`);
  });

  it("refuses more than 10,000 rows", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    deps.queries.countResult = 10_001;

    expect(await run(deps, story)).toEqual({ ok: false, code: "too_large" });
    expect(reviewAudit(deps)).toEqual([]);
    expect(deps.queries.calls.some((c) => c.method === "exportBatch")).toBe(false);
  });

  it("records the export with its filter, never the search text", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    deps.queries.countResult = 2;

    const result = await run(
      deps,
      story,
      { versions: "all", text: "both", paths: true },
      { ...EMPTY_QUERY, q: "ana", from: "2026-10-01" },
    );

    expect(result).toMatchObject({ ok: true, count: 2 });
    const audit = reviewAudit(deps);
    expect(audit).toEqual([
      {
        action: "submissions_exported",
        actorEmail: OWNER.email,
        targetId: story.formId,
        ip: OWNER.ip,
        details: {
          versions: "all",
          text: "both",
          paths: true,
          count: 2,
          search: true,
          from: "2026-10-01",
        },
      },
    ]);
    expect(JSON.stringify(audit[0]?.details)).not.toContain("ana");
  });

  it("records the status, plan and with-files filters when set", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    deps.queries.countResult = 1;

    await run(deps, story, undefined, {
      ...EMPTY_QUERY,
      status: "viewed",
      plan: "waiting",
      media: true,
      to: "2026-10-18",
    });

    expect(reviewAudit(deps).map((e) => e.details)).toEqual([
      {
        versions: "all",
        text: "original",
        paths: false,
        count: 1,
        search: false,
        to: "2026-10-18",
        status: "viewed",
        plan: "waiting",
        media: true,
      },
    ]);
  });

  it("names the file by slug and time", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);

    expect(await run(deps, story)).toMatchObject({
      ok: true,
      filename: "story-form-20261018-1500.csv",
    });
  });
});

describe("exportLocale", () => {
  it("exportLocale", () => {
    expect(exportLocale("es")).toBe("es");
    expect(exportLocale("bilingual")).toBe("es");
    expect(exportLocale("en")).toBe("en");
  });
});
