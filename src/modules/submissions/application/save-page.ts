import { discardRecordFiles } from "@/modules/media/application";
import { evaluateVisibility, validatePage, type ValidationIssue } from "@/shared/domain/form-model";
import { todayIn } from "../domain/dates";
import {
  clampStartedAt,
  isExpired,
  newInProgress,
  removeUpload,
  withFileAnswers,
  type InProgress,
  type PendingPage,
  type RefusedFile,
  type RawValues,
} from "../domain/in-progress";
import { localeFor, pickLocale } from "../domain/locale";
import { firstPageKey, nextPageKey, pagePosition, previousPageKey } from "../domain/navigation";
import { decoyReference, isHoneypotFilled } from "../domain/protection";
import { omitKeys, pageInputKeys, storePageAnswers } from "./answers";
import type { SubmissionsDeps } from "./deps";
import type { PagePost, PostOutcome } from "./fill-state";
import type { OpenContext } from "./post-context";
import { discardQuietly, errorClass, mergeBatch, stageIncoming } from "./staging";

interface Saved {
  outcome: PostOutcome;
  /** Staging references to delete once the unit of work has ended. */
  discard: string[];
}

/** The entries of `source` whose key is one of `keys`: never a key of another page. */
function pickKeys<T>(
  source: Readonly<Record<string, T>>,
  keys: readonly string[],
): Record<string, T> {
  return Object.fromEntries(Object.entries(source).filter(([k]) => keys.includes(k)));
}

/**
 * The model's issues, with the issue of a field that has an override (a
 * decode or count issue) replaced by it in place, and overrides for fields
 * the model did not flag appended.
 */
function withOverrides(
  model: readonly ValidationIssue[],
  overrides: readonly ValidationIssue[],
): ValidationIssue[] {
  const byField = new Map<string, ValidationIssue>();
  for (const o of overrides) if (!byField.has(o.field)) byField.set(o.field, o);
  const used = new Set<string>();
  const result: ValidationIssue[] = [];
  for (const issue of model) {
    const override = byField.get(issue.field);
    if (!override) {
      result.push(issue);
    } else if (!used.has(issue.field)) {
      used.add(issue.field);
      result.push(override);
    }
  }
  for (const [field, override] of byField) if (!used.has(field)) result.push(override);
  return result;
}

/**
 * Saves one page post: Next, Back, the language switch or a Remove. Every
 * post stores the page's valid answers server-side, which lets Back, Next and
 * a refresh keep them (specs/ui-ux/renderer.md, "Navigation and state"). The
 * honeypot applies to every post and ends in a silent accept; the minimum
 * fill time is checked at Submit only (specs/system/security.md, "Public form
 * abuse protection"). Submit never reaches here.
 */
export async function savePage(
  deps: SubmissionsDeps,
  context: OpenContext,
  post: PagePost,
): Promise<PostOutcome> {
  const { form, version: pinned, record: existing } = context;
  const doc = pinned.document;
  const now = deps.clock.now();

  const silentAccept = async (): Promise<PostOutcome> => {
    if (existing) {
      await deps.uow.run((uow) => deps.inProgress.delete(uow, existing.id));
      try {
        await discardRecordFiles(deps.media, existing.id);
      } catch (error) {
        deps.logger.warn("staged files not removed", {
          recordId: existing.id,
          errorClass: errorClass(error),
        });
      }
    }
    return { kind: "decoy", reference: decoyReference(form.settings.referencePrefix, deps.random) };
  };

  if (isHoneypotFilled(post.honeypot)) return silentAccept();
  if (!doc.pages.some((p) => p.key === post.pageKey)) return { kind: "expired" };
  if (!existing && post.pageKey !== firstPageKey(doc, deps.registry)) return { kind: "expired" };

  const recordId = existing?.id ?? deps.ids.newId();
  const batch = await stageIncoming(deps, {
    recordId,
    version: doc,
    pageKey: post.pageKey,
    existing: existing?.files ?? {},
    incoming: post.incoming,
  });

  let saved: Saved;
  try {
    saved = await deps.uow.run(async (uow): Promise<Saved> => {
      let record: InProgress;
      if (existing) {
        const locked = await deps.inProgress.findForUpdate(uow, existing.id);
        if (!locked || isExpired(locked, now))
          return { outcome: { kind: "expired" }, discard: batch.refs };
        record = locked;
      } else {
        const wanted = post.action.kind === "language" ? post.action.locale : null;
        record = newInProgress({
          id: recordId,
          formId: form.id,
          versionId: pinned.id,
          locale:
            wanted !== null
              ? localeFor(doc.languages, wanted)
              : pickLocale(doc.languages, post.acceptLanguage),
          pageKey: post.pageKey,
          submitToken: deps.ids.newId(),
          startedAt: clampStartedAt(post.renderedAt, now),
          now,
        });
      }

      const merged = mergeBatch(record, batch, doc, deps.registry);
      record = merged.record;
      const discard = [...merged.overflow];
      // Files that lost a race for the per-submission size are reported like the ones refused up front.
      const refusedFiles = [
        ...batch.refused,
        ...merged.oversize.map((o): RefusedFile => ({
          fieldKey: o.fieldKey,
          code: "submission_too_large",
          name: batch.names[o.stagingRef] ?? "",
        })),
      ];

      const keys = pageInputKeys(doc, deps.registry, post.pageKey);
      if (post.action.kind === "remove") {
        const { fileId } = post.action;
        const owner = keys.uploads.find((k) => record.files[k]?.some((f) => f.id === fileId));
        if (owner) {
          const { files, removed } = removeUpload(record.files, fileId);
          record = { ...record, files };
          if (removed) discard.push(removed.stagingRef);
        }
      }

      // The body is the stored answers of the other pages plus only this page's posted keys, so
      // a post cannot name an earlier page's key to steer a condition.
      const stored = omitKeys(record.answers, keys.answers);
      const body = withFileAnswers(
        { ...stored, ...pickKeys(post.answers, keys.answers) },
        record.files,
      );
      const validation = validatePage(
        doc,
        deps.registry,
        body,
        post.pageKey,
        { today: todayIn(form.settings.timezone, now) },
        { enforceRequired: post.action.kind === "next" },
      );

      const visible = evaluateVisibility(doc, body, deps.registry).fields;
      const decodeIssues = post.decodeIssues.filter(
        (i) => keys.answers.includes(i.field) && visible.get(i.field) === true,
      );
      const overrides = [...decodeIssues, ...merged.issues];
      const overridden = new Set<string>(overrides.map((i) => i.field));
      const valid = Object.fromEntries(
        Object.entries(validation.answers).filter(([k]) => !overridden.has(k)),
      );
      const issues = withOverrides(validation.issues, overrides);

      record = {
        ...record,
        answers: storePageAnswers(record.answers, doc, deps.registry, post.pageKey, valid),
        updatedAt: now,
      };
      const raw: RawValues = pickKeys(post.raw, keys.answers);
      const holdsPage = (pending: PendingPage): InProgress => ({
        ...record,
        pageKey: post.pageKey,
        pending,
      });
      const answersNow = () => withFileAnswers(record.answers, record.files);
      const refusedOutcome = (r: InProgress): PostOutcome => ({
        kind: "refused",
        recordId: r.id,
        locale: r.locale,
        page: pagePosition(doc, answersNow(), deps.registry, r.pageKey).n,
        refusedFiles,
      });
      const refused = (r: InProgress): PostOutcome =>
        refusedFiles.length === 0 ? { kind: "show", recordId: r.id } : refusedOutcome(r);

      let outcome: PostOutcome;
      switch (post.action.kind) {
        case "next": {
          if (issues.length > 0 || refusedFiles.length > 0) {
            record = holdsPage({ pageKey: post.pageKey, raw, issues });
            outcome = refusedOutcome(record);
          } else {
            const to = nextPageKey(doc, answersNow(), deps.registry, post.pageKey);
            record = { ...record, pageKey: to ?? post.pageKey, pending: null };
            outcome = { kind: "show", recordId: record.id };
          }
          break;
        }
        case "back": {
          const to = previousPageKey(doc, answersNow(), deps.registry, post.pageKey);
          record = { ...record, pageKey: to ?? post.pageKey, pending: null };
          outcome = { kind: "show", recordId: record.id };
          break;
        }
        default: {
          // Language switch and Remove: stay, keep what was typed. Only count issues are shown,
          // so files that were not taken are not dropped without a word.
          const locale =
            post.action.kind === "language"
              ? localeFor(doc.languages, post.action.locale)
              : record.locale;
          record = holdsPage({ pageKey: post.pageKey, raw, issues: merged.issues });
          record = { ...record, locale };
          outcome = refused(record);
          break;
        }
      }

      if (existing) await deps.inProgress.update(uow, record);
      else await deps.inProgress.insert(uow, record);
      return { outcome, discard };
    });
  } catch (error) {
    await discardQuietly(deps, batch.refs);
    throw error;
  }

  await discardQuietly(deps, saved.discard);
  return saved.outcome;
}
