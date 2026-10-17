import {
  loadForm,
  resolvePublicForm,
  type Form,
  type FormVersion,
} from "@/modules/definitions/application";
import type { Locale } from "@/shared/domain/localized-text";
import {
  isExpired,
  withFileAnswers,
  type PendingPage,
  type StagedUpload,
} from "../domain/in-progress";
import { pickLocale } from "../domain/locale";
import { firstPageKey, nextPageKey, pagePosition, previousPageKey } from "../domain/navigation";
import type { SubmissionsDeps } from "./deps";
import type { FillState } from "./fill-state";

/** Everything the renderer needs to draw one page. */
export interface PageView {
  locale: Locale;
  pageKey: string;
  position: { n: number; total: number };
  isFirst: boolean;
  isLast: boolean;
  answers: Record<string, unknown>;
  files: Record<string, StagedUpload[]>;
  /** The last refused post of this page, when the record holds one. */
  pending: PendingPage | null;
  submitToken: string | null;
  renderedAt: Date;
  hasRecord: boolean;
}

export type ViewResult =
  | { screen: "not_found" }
  | { screen: "closed"; form: Form }
  | { screen: "not_open"; form: Form; opensAt: string }
  | { screen: "expired"; form: Form }
  | { screen: "confirmation"; form: Form; version: FormVersion; locale: Locale; reference: string }
  | { screen: "page"; form: Form; version: FormVersion; page: PageView };

/**
 * What a GET of the public link shows: the page the visitor is on, or the
 * screen that replaces it. See specs/ui-ux/renderer.md, "Screens" and
 * "Navigation and state".
 */
export async function viewForm(
  deps: SubmissionsDeps,
  input: { slug: string; state: FillState; acceptLanguage: string | null; expired: boolean },
): Promise<ViewResult> {
  const { state } = input;

  if (state.kind === "done") {
    const submission = await deps.submissions.findBySubmitToken(state.submitToken);
    if (submission) {
      const form = await loadForm(deps.definitions, submission.formId);
      const version = await deps.versions.get(deps.definitions, submission.versionId);
      if (form?.slug === input.slug && version)
        return {
          screen: "confirmation",
          form,
          version,
          locale: submission.locale,
          reference: submission.reference,
        };
    }
  }

  const resolved = await resolvePublicForm(deps.definitions, input.slug);
  // A decoy shows its confirmation whatever the form's state, as a done cookie does, so a
  // silent accept never reads differently from a real submission.
  if (
    state.kind === "decoy" &&
    (resolved.state === "closed" || resolved.state === "not_open_yet")
  ) {
    const { form } = resolved;
    const version =
      form.currentVersionId === null
        ? null
        : await deps.versions.get(deps.definitions, form.currentVersionId);
    if (version)
      return {
        screen: "confirmation",
        form,
        version,
        locale: pickLocale(version.document.languages, input.acceptLanguage),
        reference: state.reference,
      };
  }
  switch (resolved.state) {
    case "not_found":
      return { screen: "not_found" };
    case "closed":
      return { screen: "closed", form: resolved.form };
    case "not_open_yet":
      return { screen: "not_open", form: resolved.form, opensAt: resolved.opensAt };
    case "open":
      break;
  }
  const { form, version: current } = resolved;

  if (state.kind === "decoy")
    return {
      screen: "confirmation",
      form,
      version: current,
      locale: pickLocale(current.document.languages, input.acceptLanguage),
      reference: state.reference,
    };

  const now = deps.clock.now();
  if (state.kind === "record") {
    const record = await deps.inProgress.find(state.id);
    if (!record || record.formId !== form.id || isExpired(record, now))
      return { screen: "expired", form };
    const version = await deps.versions.get(deps.definitions, record.versionId);
    if (!version) return { screen: "expired", form };
    const answers = withFileAnswers(record.answers, record.files);
    const { document } = version;
    return {
      screen: "page",
      form,
      version,
      page: {
        locale: record.locale,
        pageKey: record.pageKey,
        position: pagePosition(document, answers, deps.registry, record.pageKey),
        isFirst: previousPageKey(document, answers, deps.registry, record.pageKey) === null,
        isLast: nextPageKey(document, answers, deps.registry, record.pageKey) === null,
        answers: record.answers,
        files: record.files,
        pending: record.pending?.pageKey === record.pageKey ? record.pending : null,
        submitToken: record.submitToken,
        renderedAt: now,
        hasRecord: true,
      },
    };
  }

  if (input.expired) return { screen: "expired", form };

  const { document } = current;
  const pageKey = firstPageKey(document, deps.registry);
  const isLast = nextPageKey(document, {}, deps.registry, pageKey) === null;
  return {
    screen: "page",
    form,
    version: current,
    page: {
      locale: pickLocale(document.languages, input.acceptLanguage),
      pageKey,
      position: pagePosition(document, {}, deps.registry, pageKey),
      isFirst: true,
      isLast,
      answers: {},
      files: {},
      pending: null,
      // A one-page form is submitted from here, before any record: a fresh token per render lets
      // submitForm answer a double click with one submission (specs/system/security.md).
      submitToken: isLast ? deps.ids.newId() : null,
      renderedAt: now,
      hasRecord: false,
    },
  };
}
