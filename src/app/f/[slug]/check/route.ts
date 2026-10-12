import { getContainer } from "@/app/container";
import { checkField, postContext } from "@/modules/submissions/application";
import {
  FILL_COOKIE,
  parseFillState,
  readCookie,
} from "@/modules/submissions/presentation/cookies";
import { decodeField } from "@/modules/submissions/presentation/decode";
import { json, plain, readFormData } from "@/modules/submissions/presentation/http";
import { issueMessage } from "@/modules/submissions/presentation/messages";
import { resolveText } from "@/shared/domain/localized-text";
import { errorClass, requestLocale } from "../_lib/respond";

/** One field's value and the control fields; far below this. */
const CHECK_BODY_LIMIT = 64 * 1024;

/**
 * POST /f/<slug>/check: the blur check of one field by the server's own rules, answered as
 * `{ message }`, null when the field is fine. See specs/ui-ux/renderer.md, "Validation and
 * errors" and "Routes".
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
    if (!context.ok) return json({ message: null });
    const doc = context.version.document;

    const form = await readFormData(request, CHECK_BODY_LIMIT);
    if (form === "malformed") return plain(400);
    if (form === "too_large") return plain(413);
    const key = form.get("_field");
    const field = doc.pages.flatMap((p) => p.fields).find((f) => f.key === key);
    if (!field) return plain(400);
    const decoded = decodeField(form, field);
    const result = checkField(deps, context, {
      fieldKey: field.key,
      answer: decoded.value,
      decodeIssue: decoded.issue,
    });
    if (result === null) return plain(400);
    if (result.issue === null) return json({ message: null });
    const locale = requestLocale(
      doc.languages,
      form.get("_locale"),
      context.record,
      request.headers.get("accept-language"),
    );
    const label = resolveText(result.field.label, locale, doc.languages);
    return json({ message: issueMessage(result.issue, label, locale) });
  } catch (error) {
    container.logger.error("check route failed", { slug, error: errorClass(error) });
    return json({ ok: false, message: null }, 500);
  }
}
