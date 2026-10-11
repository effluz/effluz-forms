import type { LocalizedText } from "@/shared/domain/localized-text";
import type { Form, FormStatus } from "../domain/form";
import type { Actor, DefinitionsDeps } from "./deps";
import type { FormTab } from "./ports/form-repository";
import type { SubmissionSummary } from "./ports/submission-stats";

export interface FormListRow {
  id: string;
  slug: string;
  title: LocalizedText;
  status: FormStatus;
  versionNumber: number | null;
  /** Submissions since the actor last opened the form; all of them when never opened. */
  newCount: number;
  total: number;
  lastReceivedAt: Date | null;
  closesAt: string | null;
}

export interface FormList {
  rows: FormListRow[];
  counts: Record<FormTab, number>;
}

export interface ListFormsInput {
  tab: FormTab;
  search?: string;
}

const NO_SUBMISSIONS: SubmissionSummary = { total: 0, lastReceivedAt: null };
const titleCollator = new Intl.Collator("en", { sensitivity: "base" });

function sortTitle(title: LocalizedText): string {
  return [title.en, title.es].find((text) => text !== undefined && text.trim() !== "") ?? "";
}

function byLastSubmissionThenTitle(a: FormListRow, b: FormListRow): number {
  const at = a.lastReceivedAt?.getTime() ?? null;
  const bt = b.lastReceivedAt?.getTime() ?? null;
  if (at !== bt) {
    if (at === null) return 1;
    if (bt === null) return -1;
    return bt - at;
  }
  return (
    titleCollator.compare(sortTitle(a.title), sortTitle(b.title)) ||
    (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
  );
}

async function toRow(
  deps: DefinitionsDeps,
  form: Form,
  summary: SubmissionSummary,
  lastOpened: Date | undefined,
): Promise<FormListRow> {
  const newCount =
    lastOpened === undefined
      ? summary.total
      : await deps.stats.countReceivedAfter(form.id, lastOpened);
  return {
    id: form.id,
    slug: form.slug,
    title: form.title,
    status: form.status,
    versionNumber: form.currentVersionNumber,
    newCount,
    total: summary.total,
    lastReceivedAt: summary.lastReceivedAt,
    closesAt: form.settings.closesAt ?? null,
  };
}

/**
 * The manager's home list for one tab, with the counts of every tab.
 * See specs/ui-ux/manager.md, "Forms list (home)".
 */
export async function listForms(
  deps: DefinitionsDeps,
  actor: Actor,
  input: ListFormsInput,
): Promise<FormList> {
  const [forms, counts] = await Promise.all([
    deps.forms.list(input.tab, input.search),
    deps.forms.counts(),
  ]);
  const ids = forms.map((form) => form.id);
  const [summaries, opened] = await Promise.all([
    deps.stats.summary(ids),
    deps.forms.lastOpened(actor.email, ids),
  ]);
  const rows = await Promise.all(
    forms.map((form) =>
      toRow(deps, form, summaries.get(form.id) ?? NO_SUBMISSIONS, opened.get(form.id)),
    ),
  );
  return { rows: rows.sort(byLastSubmissionThenTitle), counts };
}
