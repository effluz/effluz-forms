import { getContainer } from "@/app/container";
import {
  postContext,
  uploadFields,
  uploadFile,
  type InProgress,
} from "@/modules/submissions/application";
import {
  FILL_COOKIE,
  fillCookie,
  parseFillState,
  readCookie,
} from "@/modules/submissions/presentation/cookies";
import { t } from "@/modules/submissions/presentation/copy";
import { formatBytes, formatNumber } from "@/modules/submissions/presentation/format";
import {
  FILE_BODY_LIMIT,
  json,
  plain,
  readFormData,
} from "@/modules/submissions/presentation/http";
import { uploadRefusalMessage } from "@/modules/submissions/presentation/messages";
import { visiblePages, type FieldTypeRegistry, type Version } from "@/shared/domain/form-model";
import { resolveText } from "@/shared/domain/localized-text";
import { errorClass, requestLocale } from "../_lib/respond";

/** The browser fills `{file}` with the name it kept; the server never sees it. */
const FILE = "{file}";

/** The first upload field of the page the record is on, or of the first page. */
function currentUploadField(
  version: Version,
  registry: FieldTypeRegistry,
  record: InProgress | null,
) {
  const pageKey =
    record?.pageKey ?? (visiblePages(version, {}, registry)[0] ?? version.pages[0])?.key;
  const keys = new Set(version.pages.find((p) => p.key === pageKey)?.fields.map((f) => f.key));
  return uploadFields(version, registry).find((u) => keys.has(u.field.key)) ?? null;
}

/**
 * POST /f/<slug>/files: the early upload of one file with script, answered as JSON in the
 * shape `upload-request.ts` reads. A storage failure answers the retryable failure.
 * See specs/ui-ux/renderer.md, "File upload" and "Routes".
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const container = getContainer();
  try {
    const deps = container.submissions;
    const state = parseFillState(readCookie(request.headers.get("cookie"), FILL_COOKIE));
    const context = await postContext(deps, { slug, state, submitToken: null });
    if (!context.ok) return json({ ok: false, message: null }, 410);
    const doc = context.version.document;
    const acceptLanguage = request.headers.get("accept-language");

    const form = await readFormData(request, FILE_BODY_LIMIT);
    if (form === "malformed") return plain(400);
    if (form === "too_large") {
      const target = currentUploadField(doc, deps.registry, context.record);
      if (!target) return plain(413);
      const locale = requestLocale(doc.languages, null, context.record, acceptLanguage);
      const label = resolveText(target.field.label, locale, doc.languages);
      const message = uploadRefusalMessage(
        "file_too_large",
        { file: FILE, label, limits: target.limits },
        locale,
      );
      return json({ ok: false, message }, 413);
    }

    const fieldKey = form.get("field");
    const file = form.get("file");
    const target = uploadFields(doc, deps.registry).find((u) => u.field.key === fieldKey);
    if (!target || file === null || typeof file === "string") return plain(400);
    const locale = requestLocale(
      doc.languages,
      form.get("_locale"),
      context.record,
      acceptLanguage,
    );

    const outcome = await uploadFile(deps, context, {
      fieldKey: target.field.key,
      bytes: new Uint8Array(await file.arrayBuffer()),
      renderedAt: null,
      acceptLanguage,
    });
    if (!outcome.ok) {
      const label = resolveText(target.field.label, locale, doc.languages);
      const message = uploadRefusalMessage(
        outcome.code,
        { file: FILE, label, limits: target.limits },
        locale,
      );
      return json({ ok: false, message }, outcome.code === "expired" ? 410 : 422);
    }
    const label = t(locale, "file_row", {
      n: formatNumber(outcome.count, locale),
      size: formatBytes(outcome.file.size, locale),
    });
    return json({ ok: true, file: outcome.file, count: outcome.count, label }, 200, [
      fillCookie(slug, { kind: "record", id: outcome.recordId }, container.config.session.secure),
    ]);
  } catch (error) {
    container.logger.error("files route failed", { slug, error: errorClass(error) });
    return json({ ok: false, message: null }, 500);
  }
}
