import type { Actor, FormVersion } from "@/modules/definitions/application";
import {
  exportColumns,
  exportRow,
  fieldIndex,
  type ExportColumn,
} from "@/shared/domain/form-model";
import type { Languages, Locale } from "@/shared/domain/localized-text";
import { CSV_BOM, EXPORT_ROW_CAP, csvLine } from "../domain/csv";
import type { ListQuery } from "../domain/list-query";
import type { ReviewStatus } from "../domain/status";
import { listFilterFor, loadFormContext, type FormContext } from "./context";
import type { ReviewDeps } from "./deps";
import type { ExportSource, ListCursor, ListFilter } from "./ports/review-queries";

/** Rows read per `exportBatch` call. */
const EXPORT_BATCH_SIZE = 500;

export interface ExportOptions {
  versions: "filter" | "all";
  text: "original" | "corrected" | "both";
  paths: boolean;
}

/** Fixed headers and values in the export language, supplied by the presentation (copy lives there). */
export interface ExportLabels {
  reference: string;
  status: string;
  received: string;
  version: string;
  language: string;
  planned: string;
  postLink: string;
  files: string;
  staffPhotos: string;
  corrected(label: string): string;
  /** The Language column holds the locale code, `en` or `es`. */
  statuses: Record<ReviewStatus, string>;
}

export type ExportResult =
  | { ok: true; filename: string; count: number; body: ReadableStream<Uint8Array> }
  | { ok: false; code: "not_found" | "too_large" };

/** Spanish when the form has Spanish, else English (no reviewer language preference yet). */
export function exportLocale(languages: Languages): Locale {
  return languages === "en" ? "en" : "es";
}

/** How one output column takes its value from a field column. */
type Source = "original" | "corrected_or_original" | "correction_only";

interface OutputColumn {
  index: number;
  column: ExportColumn;
  source: Source;
}

function outputColumns(
  columns: readonly ExportColumn[],
  text: ExportOptions["text"],
  curatable: (column: ExportColumn) => boolean,
): OutputColumn[] {
  return columns.flatMap((column, index): OutputColumn[] => {
    if (!curatable(column)) return [{ index, column, source: "original" }];
    if (text === "original") return [{ index, column, source: "original" }];
    if (text === "corrected") return [{ index, column, source: "corrected_or_original" }];
    return [
      { index, column, source: "original" },
      { index, column, source: "correction_only" },
    ];
  });
}

const two = (n: number) => String(n).padStart(2, "0");

/** `YYYYMMDD-HHmm` in UTC. */
function fileStamp(at: Date): string {
  const date = `${String(at.getUTCFullYear())}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}`;
  return `${date}-${two(at.getUTCHours())}${two(at.getUTCMinutes())}`;
}

/** ISO 8601 in UTC to the second: `2026-10-18T15:00:00Z`. */
function receivedCell(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The sender's keys in the pinned version's field order, then position (the read model sorts by key). */
function senderPaths(version: FormVersion | undefined, row: ExportSource): string {
  const order = version ? fieldIndex(version.document) : new Map<string, { order: number }>();
  const rank = (key: string) => order.get(key)?.order ?? Number.MAX_SAFE_INTEGER;
  return [...row.senderFiles]
    .sort((a, b) => rank(a.fieldKey) - rank(b.fieldKey))
    .map((file) => file.key)
    .join("; ");
}

/** The header row and a function from one source row to its cells. */
function csvLayout(
  deps: ReviewDeps,
  ctx: FormContext,
  versions: readonly FormVersion[],
  options: ExportOptions,
  labels: ExportLabels,
  locale: Locale,
): { header: string[]; cells(row: ExportSource): string[] } {
  const columns = exportColumns(
    versions.map((v) => v.document),
    deps.registry,
    locale,
  );
  const curatable = (column: ExportColumn) =>
    deps.registry.get(column.typeId).reviewTraits?.curatable === true;
  const output = outputColumns(columns, options.text, curatable);
  const byId = new Map(ctx.versions.map((v) => [v.id, v]));

  const header = [
    labels.reference,
    labels.status,
    labels.received,
    labels.version,
    labels.language,
    ...(ctx.postPlan ? [labels.planned] : []),
    labels.postLink,
    ...output.map((o) =>
      o.source === "correction_only" ? labels.corrected(o.column.header) : o.column.header,
    ),
    ...(options.paths ? [labels.files, labels.staffPhotos] : []),
  ];

  const cells = (row: ExportSource): string[] => {
    const version = byId.get(row.versionId);
    const fieldCells = (answers: Record<string, unknown>) =>
      version ? exportRow(columns, version.document, deps.registry, answers, locale) : [];
    const original = fieldCells(row.answers);
    const corrected =
      options.text === "original"
        ? original
        : fieldCells({ ...row.answers, ...row.curatedAnswers });
    return [
      row.reference,
      labels.statuses[row.status],
      receivedCell(row.receivedAt),
      version ? String(version.number) : "",
      row.locale,
      ...(ctx.postPlan ? [row.plannedOn ?? ""] : []),
      row.postUrl ?? "",
      ...output.map((o) => {
        if (o.source === "original") return original[o.index] ?? "";
        if (o.source === "corrected_or_original") return corrected[o.index] ?? "";
        return Object.hasOwn(row.curatedAnswers, o.column.key) ? (corrected[o.index] ?? "") : "";
      }),
      ...(options.paths ? [senderPaths(version, row), row.staffKeys.join("; ")] : []),
    ];
  };
  return { header, cells };
}

/** Pulls `exportBatch` 500 rows at a time and encodes them; nothing is read before the body is. */
function csvStream(
  deps: ReviewDeps,
  filter: ListFilter,
  layout: { header: string[]; cells(row: ExportSource): string[] },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let started = false;
  let written = 0;
  let after: ListCursor | null = null;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (!started) {
          started = true;
          controller.enqueue(encoder.encode(CSV_BOM + csvLine(layout.header)));
          return;
        }
        const size = Math.min(EXPORT_BATCH_SIZE, EXPORT_ROW_CAP - written);
        if (size <= 0) {
          controller.close();
          return;
        }
        const batch = await deps.queries.exportBatch(filter, after, size);
        const last = batch.at(-1);
        if (last !== undefined) {
          controller.enqueue(
            encoder.encode(batch.map((row) => csvLine(layout.cells(row))).join("")),
          );
          written += batch.length;
          after = { receivedAt: last.receivedAt, submissionId: last.submissionId };
        }
        if (batch.length < size) controller.close();
      },
    },
    { highWaterMark: 0 },
  );
}

/**
 * The CSV export (specs/use-cases/review-submissions.md, "Main flow: export"). Counts,
 * refuses more than 10,000 rows, records `submissions_exported` with the filter (never
 * the search text), then streams the rows in list order.
 */
export async function exportStories(
  deps: ReviewDeps,
  actor: Actor,
  input: {
    formId: string;
    query: ListQuery;
    options: ExportOptions;
    labels: (locale: Locale) => ExportLabels;
  },
): Promise<ExportResult> {
  const ctx = await loadFormContext(deps, input.formId);
  if (!ctx) return { ok: false, code: "not_found" };
  const { query, options } = input;
  const all = options.versions === "all";
  const listed = listFilterFor(ctx, query, deps.registry);
  const filter: ListFilter = all ? { ...listed, versionId: null } : listed;
  const count = await deps.queries.count(filter);
  if (count > EXPORT_ROW_CAP) return { ok: false, code: "too_large" };

  const details: Record<string, string | number | boolean> = {
    versions: all || query.version === null ? "all" : query.version,
    text: options.text,
    paths: options.paths,
    count,
    search: query.q !== null,
  };
  if (query.from !== null) details.from = query.from;
  if (query.to !== null) details.to = query.to;
  const now = deps.clock.now();
  await deps.uow.run((uow) =>
    deps.audit.record(
      uow,
      {
        action: "submissions_exported",
        actorEmail: actor.email,
        targetId: ctx.form.id,
        ip: actor.ip,
        details,
      },
      now,
    ),
  );

  const locale = exportLocale(ctx.form.languages);
  const versions =
    all || query.version === null
      ? ctx.versions
      : ctx.versions.filter((v) => v.number === query.version);
  const layout = csvLayout(deps, ctx, versions, options, input.labels(locale), locale);
  return {
    ok: true,
    filename: `${ctx.form.slug}-${fileStamp(now)}.csv`,
    count,
    body: csvStream(deps, filter, layout),
  };
}
