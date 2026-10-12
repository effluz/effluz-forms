import { todayIn } from "../domain/dates";
import {
  clampStartedAt,
  isExpired,
  newInProgress,
  removeUpload,
  withFileAnswers,
  type InProgress,
  type PendingPage,
} from "../domain/in-progress";
import { localeFor, pickLocale } from "../domain/locale";
import { firstPageKey, nextPageKey, pagePosition, previousPageKey } from "../domain/navigation";
import { isHoneypotFilled } from "../domain/protection";
import { pageInputKeys, pageRaw } from "./answers";
import type { SubmissionsDeps } from "./deps";
import type { PagePost, PostOutcome } from "./fill-state";
import type { OpenContext } from "./post-context";
import { checkPostedPage } from "./posted-page";
import { discardAfterSilentAccept, silentAccept } from "./silent-accept";
import { discardQuietly, mergeBatch, refusedOf, stageIncoming } from "./staging";

interface Saved {
  outcome: PostOutcome;
  /** Staging references to delete once the unit of work has ended. */
  discard: string[];
  /** Set by a silent accept: the record whose staging prefix goes after commit. */
  decoyOf?: string;
}

/**
 * Saves one page post: Next, Back, the language switch or a Remove. Every
 * post stores the page's valid answers server-side, which lets Back, Next and
 * a refresh keep them (specs/ui-ux/renderer.md, "Navigation and state"). A
 * filled honeypot on any post ends in a silent accept; the minimum fill time
 * is checked at Submit only (specs/system/security.md, "Public form abuse
 * protection"). Submit never reaches here.
 */
export async function savePage(
  deps: SubmissionsDeps,
  context: OpenContext,
  post: PagePost,
): Promise<PostOutcome> {
  const { form, version: pinned, record: existing } = context;
  const doc = pinned.document;
  const now = deps.clock.now();

  if (!doc.pages.some((p) => p.key === post.pageKey)) return { kind: "expired" };
  if (!existing && post.pageKey !== firstPageKey(doc, deps.registry)) return { kind: "expired" };
  const startedAt = existing?.startedAt ?? clampStartedAt(post.renderedAt, now);

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
      let locked: InProgress | null = null;
      if (existing) {
        locked = await deps.inProgress.findForUpdate(uow, existing.id);
        if (!locked || isExpired(locked, now))
          return { outcome: { kind: "expired" }, discard: batch.refs };
      }
      // A filled honeypot is a silent accept on every post; nothing is inserted without a record.
      if (isHoneypotFilled(post.honeypot)) {
        const outcome = await silentAccept(deps, uow, {
          form,
          recordId,
          locked: locked !== null,
        });
        return { outcome, discard: batch.refs, decoyOf: recordId };
      }
      const wanted = post.action.kind === "language" ? post.action.locale : null;
      let record: InProgress =
        locked ??
        newInProgress({
          id: recordId,
          formId: form.id,
          versionId: pinned.id,
          locale:
            wanted !== null
              ? localeFor(doc.languages, wanted)
              : pickLocale(doc.languages, post.acceptLanguage),
          pageKey: post.pageKey,
          submitToken: deps.ids.newId(),
          startedAt,
          now,
        });

      const merged = mergeBatch(record, batch, doc, deps.registry);
      record = merged.record;
      const discard = [...merged.overflow];
      const refusedFiles = refusedOf(batch, merged.oversize);

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

      const checked = checkPostedPage(deps.registry, {
        version: doc,
        record,
        post,
        today: todayIn(form.settings.timezone, now),
        enforceRequired: post.action.kind === "next",
        countIssues: merged.issues,
      });
      const { issues } = checked;
      record = { ...record, answers: checked.answers, updatedAt: now };
      const raw = pageRaw(post.raw, keys.answers);
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
          // A file Back brought that was not taken is reported on this page, as on Next.
          if (refusedFiles.length > 0) {
            record = holdsPage({ pageKey: post.pageKey, raw, issues: merged.issues });
            outcome = refusedOutcome(record);
            break;
          }
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

  if (saved.decoyOf !== undefined)
    await discardAfterSilentAccept(deps, { recordId: saved.decoyOf, refs: saved.discard });
  else await discardQuietly(deps, saved.discard);
  return saved.outcome;
}
