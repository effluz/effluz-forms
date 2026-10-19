import {
  listPostPlanForms,
  loadVersion,
  type Actor,
  type Form,
  type FormVersion,
} from "@/modules/definitions/application";
import { findSubmission, lockSubmission } from "@/modules/submissions/application";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { LocalizedText } from "@/shared/domain/localized-text";
import { addDays, mondayOf, parseIsoDate, todayIn, weekDays, type IsoDate } from "../domain/days";
import { decidePlan, type PlanResolution, type PlanSlot } from "../domain/plan";
import { readiness, type Readiness } from "../domain/readiness";
import { loadStory, storyLabel } from "./context";
import { withDeadlockRetry } from "./deadlock";
import type { ReviewDeps } from "./deps";
import type { PlanEntry } from "./ports/review-queries";
import type { StoryRow } from "./ports/story-repository";

export type PlanResult =
  | { ok: true; plannedOn: IsoDate | null }
  | { ok: false; code: "not_found" | "post_plan_off" | "date_invalid" | "published" }
  /** `other` is the reference of the story holding the day. */
  | { ok: false; code: "conflict"; date: IsoDate; other: string; canSwap: boolean };

/** One story as the post plan shows it. */
export interface PlanItem {
  formId: string;
  formTitle: LocalizedText;
  reference: string;
  label: string | null;
  readiness: Readiness;
  postUrl: string | null;
  plannedOn: IsoDate | null;
  publishedOn: IsoDate | null;
}

export interface DayView {
  date: IsoDate;
  isToday: boolean;
  isPast: boolean;
  /** The unpublished story planned on the day. */
  planned: PlanItem | null;
  /** The stories published on the day. */
  published: PlanItem[];
}

export interface WeekView {
  monday: IsoDate;
  today: IsoDate;
  previous: IsoDate;
  next: IsoDate;
  /** Monday to Sunday. */
  days: DayView[];
  formsInPlan: number;
}

/** Postgres SQLSTATE for a unique violation, and the one-story-per-day index. */
const UNIQUE_VIOLATION = "23505";
const SLOT_INDEX = "story_plan_slot_key";
const MAX_CAUSE_DEPTH = 5;
/** Runs of the unit of work when the story's own day changed between the read and the locks. */
const MAX_FRESH_ATTEMPTS = 3;

function isSlotTaken(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && e !== null && typeof e === "object"; depth++) {
    if (
      "code" in e &&
      e.code === UNIQUE_VIOLATION &&
      "constraint" in e &&
      e.constraint === SLOT_INDEX
    )
      return true;
    e = "cause" in e ? e.cause : null;
  }
  return false;
}

function parseResolution(value: string): PlanResolution | null {
  return value === "swap" || value === "move" ? value : null;
}

/** Ends a unit of work without writing: it rolls back, so even the story row it created goes. */
class PlanRefusal extends Error {
  constructor(readonly outcome: PlanResult | "stale") {
    super("plan refused");
  }
}

interface Target {
  submissionId: string;
  formId: string;
  reference: string;
  date: IsoDate | null;
}

/** The planner's answer to a conflict: what to do, and the holder the dialog named. */
interface Answer {
  resolution: PlanResolution | null;
  expected: string | null;
}

/** The holder as the plan rules see it, named by its reference. */
async function holderSlot(deps: ReviewDeps, row: StoryRow): Promise<PlanSlot> {
  const submission = await findSubmission(deps.submissions, row.submissionId);
  return {
    submissionId: row.submissionId,
    reference: submission?.reference ?? "",
    plannedOn: row.plannedOn,
  };
}

/**
 * One unit of work. Locks (specs/system/database.md, "The `UnitOfWork` port"): the day
 * lock of every day the change touches, ascending, each with its unpublished holder's
 * row; then the submission row; then the story row.
 */
async function planInUnit(
  deps: ReviewDeps,
  actor: Actor,
  uow: UnitOfWork,
  target: Target,
  answer: Answer,
  own: { day: IsoDate | null; checkFresh: boolean },
): Promise<PlanResult> {
  const days = [...new Set([target.date, own.day].filter((d): d is IsoDate => d !== null))].sort();
  const holders = new Map<IsoDate, StoryRow>();
  for (const day of days) {
    const holder = await deps.stories.lockDay(uow, day);
    if (holder !== null) holders.set(day, holder);
  }
  const locked = await lockSubmission(deps.submissions, uow, target.submissionId);
  if (!locked) throw new PlanRefusal({ ok: false, code: "not_found" });
  const story = await deps.stories.lockOrCreate(uow, target.submissionId, target.formId);
  if (locked.curation.status === "published" || story.publishedOn !== null)
    throw new PlanRefusal({ ok: false, code: "published" });
  if (own.checkFresh && story.plannedOn !== null && !days.includes(story.plannedOn))
    throw new PlanRefusal("stale");

  const holderRow = target.date === null ? null : (holders.get(target.date) ?? null);
  const holder =
    holderRow === null || holderRow.submissionId === story.submissionId
      ? null
      : await holderSlot(deps, holderRow);
  const decision = decidePlan({
    story: {
      submissionId: story.submissionId,
      reference: target.reference,
      plannedOn: story.plannedOn,
    },
    date: target.date,
    holder,
    resolution: answer.resolution,
    expected: answer.expected,
  });
  if (decision.kind === "conflict")
    throw new PlanRefusal({
      ok: false,
      code: "conflict",
      date: target.date ?? "",
      other: decision.other.reference,
      canSwap: decision.canSwap,
    });

  const now = deps.clock.now();
  const before = [story, ...(holder !== null && holderRow !== null ? [holderRow] : [])];
  const rows = new Map(before.map((row) => [row.submissionId, row]));
  for (const write of decision.writes) {
    const row = rows.get(write.submissionId);
    if (!row) throw new Error(`plan write for a story it did not lock: ${write.submissionId}`);
    if (row.plannedOn === write.plannedOn) continue;
    const next = { ...row, plannedOn: write.plannedOn };
    await deps.stories.save(uow, next, now);
    rows.set(next.submissionId, next);
  }

  const heldAfter = holder === null ? null : (rows.get(holder.submissionId)?.plannedOn ?? null);
  const applied: PlanResolution | null =
    holder === null ? null : heldAfter === null ? "move" : "swap";
  for (const row of before) {
    const to = rows.get(row.submissionId)?.plannedOn ?? null;
    if (to === row.plannedOn) continue;
    await deps.audit.record(
      uow,
      {
        action: "story_planned",
        actorEmail: actor.email,
        targetId: row.submissionId,
        ip: actor.ip,
        details: {
          from: row.plannedOn ?? "none",
          to: to ?? "none",
          ...(applied === null ? {} : { resolution: applied }),
        },
      },
      now,
    );
  }
  return { ok: true, plannedOn: rows.get(story.submissionId)?.plannedOn ?? null };
}

/** Reads the story's own day, then plans under the locks; again when that day moved meanwhile. */
async function planLocked(
  deps: ReviewDeps,
  actor: Actor,
  target: Target,
  answer: Answer,
): Promise<PlanResult> {
  for (let attempt = 1; ; attempt++) {
    const day = (await deps.stories.find(target.submissionId))?.plannedOn ?? null;
    const own = { day, checkFresh: attempt < MAX_FRESH_ATTEMPTS };
    try {
      return await withDeadlockRetry(() =>
        deps.uow.run((uow) => planInUnit(deps, actor, uow, target, answer, own)),
      );
    } catch (error) {
      if (!(error instanceof PlanRefusal)) throw error;
      if (error.outcome !== "stale") return error.outcome;
    }
  }
}

/**
 * Plans a story on a day, or clears its date (specs/use-cases/curate-submission.md,
 * "Planning"). A taken day answers `conflict` until the planner picks `swap` or `move`
 * with `expected`, the reference of the holder the conflict named. A day held by another
 * story by then, or a swap once this story has no date to give, asks again. A refusal
 * writes nothing.
 */
export async function planStory(
  deps: ReviewDeps,
  actor: Actor,
  input: {
    formId: string;
    reference: string;
    date: string;
    resolution: string;
    /** The holder the conflict named. Missing or empty, it names none: a resolution asks again. */
    expected?: string;
  },
): Promise<PlanResult> {
  const found = await loadStory(deps, input.formId, input.reference);
  if (!found) return { ok: false, code: "not_found" };
  if (!found.ctx.postPlan) return { ok: false, code: "post_plan_off" };
  const date = input.date === "" ? null : parseIsoDate(input.date);
  if (input.date !== "" && date === null) return { ok: false, code: "date_invalid" };
  const target: Target = {
    submissionId: found.submission.id,
    formId: found.ctx.form.id,
    reference: found.submission.reference,
    date,
  };
  try {
    return await planLocked(deps, actor, target, {
      resolution: parseResolution(input.resolution),
      expected: input.expected === undefined || input.expected === "" ? null : input.expected,
    });
  } catch (error) {
    if (!isSlotTaken(error)) throw error;
    // The index caught a second story on a day: ask again, never moving anyone unasked.
    return planLocked(deps, actor, target, { resolution: null, expected: null });
  }
}

/** Maps read-model entries to plan items, with each story's label from its version. */
async function toItems(
  deps: ReviewDeps,
  forms: readonly Form[],
  entries: readonly PlanEntry[],
): Promise<PlanItem[]> {
  const byId = new Map(forms.map((form) => [form.id, form]));
  const versions = new Map<string, FormVersion | null>();
  const items: PlanItem[] = [];
  for (const entry of entries) {
    const form = byId.get(entry.formId);
    if (!form) continue;
    if (!versions.has(entry.versionId))
      versions.set(entry.versionId, await loadVersion(deps.definitions, entry.versionId));
    const version = versions.get(entry.versionId) ?? null;
    items.push({
      formId: entry.formId,
      formTitle: form.title,
      reference: entry.reference,
      label: version ? storyLabel(version.document, deps.registry, entry.answers) : null,
      readiness: readiness(entry.checks),
      postUrl: entry.postUrl,
      plannedOn: entry.plannedOn,
      publishedOn: entry.publishedOn,
    });
  }
  return items;
}

/**
 * The post plan's week, Monday to Sunday in the plan's zone, of `week` (any date; a
 * missing or unreadable one gives this week). Records `post_plan_viewed` once per call:
 * the rows carry labels, often names.
 */
export async function postPlanWeek(
  deps: ReviewDeps,
  actor: Actor,
  input: { week: string | null },
): Promise<WeekView> {
  const now = deps.clock.now();
  const today = todayIn(deps.planTimeZone, now);
  const asked = input.week === null ? null : parseIsoDate(input.week);
  const monday = mondayOf(asked ?? today);
  const dates = weekDays(monday);
  const sunday = dates[dates.length - 1] ?? monday;
  const forms = await listPostPlanForms(deps.definitions);
  const entries =
    forms.length === 0
      ? []
      : await deps.queries.week(
          forms.map((f) => f.id),
          monday,
          sunday,
        );
  const items = await toItems(deps, forms, entries);

  await deps.uow.run((uow) =>
    deps.audit.record(
      uow,
      {
        action: "post_plan_viewed",
        actorEmail: actor.email,
        targetId: null,
        ip: actor.ip,
        details: { week: monday },
      },
      now,
    ),
  );
  return {
    monday,
    today,
    previous: addDays(monday, -7),
    next: addDays(monday, 7),
    days: dates.map((date) => ({
      date,
      isToday: date === today,
      isPast: date < today,
      planned: items.find((i) => i.publishedOn === null && i.plannedOn === date) ?? null,
      published: items.filter((i) => i.publishedOn === date),
    })),
    formsInPlan: forms.length,
  };
}

/** "Waiting for a date": unpublished, unplanned stories of the post-plan forms, newest first. */
export async function waitingStories(
  deps: ReviewDeps,
  input: { limit: number },
): Promise<{ rows: PlanItem[]; total: number }> {
  const forms = await listPostPlanForms(deps.definitions);
  if (forms.length === 0) return { rows: [], total: 0 };
  const { rows, total } = await deps.queries.waiting(
    forms.map((f) => f.id),
    input.limit,
  );
  return { rows: await toItems(deps, forms, rows), total };
}
