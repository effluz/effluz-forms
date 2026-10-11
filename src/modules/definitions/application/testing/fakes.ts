/**
 * In-memory fakes for definitions use-case tests.
 *
 * - `makeDefinitionsDeps(overrides?)` builds a full `DefinitionsDeps` wired to
 *   the fakes below and returns the concrete fakes too, plus the shared `store`.
 * - `DefinitionsStore`: the rows behind the three repositories, so they can
 *   mirror the foreign keys of `0004_definitions.sql`: a draft, version or
 *   visit needs its form; deleting a form cascades to its draft and visits and
 *   throws while it has versions.
 * - `InMemoryFormRepository`, `InMemoryDraftRepository`,
 *   `InMemoryVersionRepository`: mirror the Postgres adapters' results and
 *   throws (`slug_taken`, `stale`, `number_taken`, update and replace of a
 *   missing row throw, a non-UUID id names no row). Rows are deep-copied in
 *   and out, so a caller can never mutate what is stored; the version store
 *   offers no mutation at all. `update` stamps `updatedAt` from the clock, as
 *   the adapter stamps `now()`. `listCalls` records `list` arguments.
 * - `FakeSubmissionStats`: `receive(formId, ...dates)` records submissions,
 *   from which `summary`, `countReceivedAfter`, `countOlderThan` and `hasAny`
 *   answer; `setAnswerCounts(formId, counts)` scripts `answerCounts`.
 * - `seedForm(deps, overrides?)` creates a form through `createForm` and
 *   returns its id; `overrides.patch` then rewrites form columns directly.
 * - Clock, ids, unit of work and audit fakes come from the shared kernel.
 *
 * Synthetic data only. Not for production code.
 */
import { assertNoPersonalData } from "@/modules/identity/application";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import {
  FakeUnitOfWorkFactory,
  FixedClock,
  InMemoryAuditLog,
  InMemoryAuditLogReader,
  SequentialIdGenerator,
} from "@/shared/application/testing/fakes";
import { buildDefaultRegistry, type Key } from "@/shared/domain/form-model";
import type { Clock } from "@/shared/application/ports/clock";
import type { Draft } from "../../domain/draft";
import type { Form, FormStatus } from "../../domain/form";
import { createForm, type CreateFormInput } from "../create-form";
import type { Actor, DefinitionsDeps } from "../deps";
import type { DraftRepository } from "../ports/draft-repository";
import type { FormRepository, FormTab } from "../ports/form-repository";
import type { SubmissionStats, SubmissionSummary } from "../ports/submission-stats";
import type { FormVersion, VersionRepository } from "../ports/version-repository";

export {
  FakeUnitOfWorkFactory,
  FixedClock,
  InMemoryAuditLog,
  InMemoryAuditLogReader,
  SequentialIdGenerator,
};
export { fakeUuid } from "@/shared/application/testing/fakes";

// Mirrors infrastructure/uuid.ts, which this layer may not import.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(id: string): void {
  if (!UUID.test(id)) throw new Error("fake store: id must be a UUID, as the uuid column requires");
}

const STATUSES_OF_TAB: Record<FormTab, FormStatus[]> = {
  active: ["draft", "published"],
  closed: ["closed"],
  archived: ["archived"],
};

function tabOf(status: FormStatus): FormTab {
  return status === "draft" || status === "published" ? "active" : status;
}

/** The rows behind the in-memory repositories. */
export class DefinitionsStore {
  readonly forms = new Map<string, Form>();
  readonly drafts = new Map<string, Draft>();
  readonly versions = new Map<string, FormVersion>();
  /** Keyed by `${formId} ${email}`. */
  readonly visits = new Map<string, { formId: string; email: string; at: Date }>();

  requireForm(formId: string): void {
    if (!this.forms.has(formId)) throw new Error(`fake store: form ${formId} does not exist`);
  }
}

export class InMemoryFormRepository implements FormRepository {
  readonly listCalls: { tab: FormTab; search?: string }[] = [];

  constructor(
    private readonly store: DefinitionsStore,
    private readonly clock: Clock,
  ) {}

  insert(_uow: UnitOfWork, form: Form): Promise<"inserted" | "slug_taken"> {
    requireUuid(form.id);
    if (this.store.forms.has(form.id)) throw new Error(`fake store: form ${form.id} exists`);
    if (this.slugOwner(form.slug) !== undefined) return Promise.resolve("slug_taken");
    this.store.forms.set(form.id, structuredClone(form));
    return Promise.resolve("inserted");
  }

  update(_uow: UnitOfWork, form: Form): Promise<"updated" | "slug_taken"> {
    const stored = UUID.test(form.id) ? this.store.forms.get(form.id) : undefined;
    if (!stored) throw new Error(`form ${form.id} does not exist`);
    const owner = this.slugOwner(form.slug);
    if (owner !== undefined && owner !== form.id) return Promise.resolve("slug_taken");
    this.store.forms.set(form.id, {
      ...structuredClone(form),
      createdAt: stored.createdAt,
      updatedAt: this.clock.now(),
    });
    return Promise.resolve("updated");
  }

  delete(_uow: UnitOfWork, id: string): Promise<void> {
    if (!UUID.test(id) || !this.store.forms.has(id)) return Promise.resolve();
    for (const version of this.store.versions.values()) {
      if (version.formId === id) throw new Error(`fake store: form ${id} has versions`);
    }
    this.store.forms.delete(id);
    this.store.drafts.delete(id);
    for (const [key, visit] of this.store.visits) {
      if (visit.formId === id) this.store.visits.delete(key);
    }
    return Promise.resolve();
  }

  findById(id: string): Promise<Form | null> {
    const form = UUID.test(id) ? this.store.forms.get(id) : undefined;
    return Promise.resolve(form ? structuredClone(form) : null);
  }

  findBySlug(slug: string): Promise<Form | null> {
    const id = this.slugOwner(slug);
    const form = id === undefined ? undefined : this.store.forms.get(id);
    return Promise.resolve(form ? structuredClone(form) : null);
  }

  list(tab: FormTab, search?: string): Promise<Form[]> {
    this.listCalls.push(search === undefined ? { tab } : { tab, search });
    const term = search?.trim().toLowerCase();
    const matches = (form: Form): boolean =>
      !term ||
      [form.slug, form.title.en, form.title.es].some(
        (value) => value !== undefined && value.toLowerCase().includes(term),
      );
    const sortKey = (form: Form): string => (form.title.en ?? form.title.es ?? "").toLowerCase();
    const found = [...this.store.forms.values()]
      .filter((form) => STATUSES_OF_TAB[tab].includes(form.status) && matches(form))
      .sort((a, b) => compare(sortKey(a), sortKey(b)) || compare(a.slug, b.slug));
    return Promise.resolve(found.map((form) => structuredClone(form)));
  }

  counts(): Promise<Record<FormTab, number>> {
    const counts: Record<FormTab, number> = { active: 0, closed: 0, archived: 0 };
    for (const form of this.store.forms.values()) counts[tabOf(form.status)] += 1;
    return Promise.resolve(counts);
  }

  markOpened(_uow: UnitOfWork, formId: string, email: string, at: Date): Promise<void> {
    this.store.requireForm(formId);
    this.store.visits.set(`${formId} ${email}`, { formId, email, at: new Date(at.getTime()) });
    return Promise.resolve();
  }

  lastOpened(email: string, formIds: string[]): Promise<Map<string, Date>> {
    const opened = new Map<string, Date>();
    for (const formId of formIds) {
      const visit = this.store.visits.get(`${formId} ${email}`);
      if (visit) opened.set(formId, new Date(visit.at.getTime()));
    }
    return Promise.resolve(opened);
  }

  private slugOwner(slug: string): string | undefined {
    for (const form of this.store.forms.values()) if (form.slug === slug) return form.id;
    return undefined;
  }
}

function compare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export class InMemoryDraftRepository implements DraftRepository {
  constructor(private readonly store: DefinitionsStore) {}

  insert(_uow: UnitOfWork, draft: Draft): Promise<void> {
    this.store.requireForm(draft.formId);
    if (this.store.drafts.has(draft.formId)) {
      throw new Error(`fake store: form ${draft.formId} already has a draft`);
    }
    this.store.drafts.set(draft.formId, structuredClone(draft));
    return Promise.resolve();
  }

  find(formId: string): Promise<Draft | null> {
    const draft = UUID.test(formId) ? this.store.drafts.get(formId) : undefined;
    return Promise.resolve(draft ? structuredClone(draft) : null);
  }

  save(_uow: UnitOfWork, draft: Draft, expectedRevision: number): Promise<"saved" | "stale"> {
    const stored = this.store.drafts.get(draft.formId);
    if (stored?.revision !== expectedRevision) return Promise.resolve("stale");
    this.store.drafts.set(draft.formId, {
      ...structuredClone(draft),
      revision: expectedRevision + 1,
    });
    return Promise.resolve("saved");
  }

  replace(_uow: UnitOfWork, draft: Draft): Promise<void> {
    const stored = this.store.drafts.get(draft.formId);
    if (!stored) throw new Error(`form ${draft.formId} has no draft`);
    this.store.drafts.set(draft.formId, {
      ...structuredClone(draft),
      revision: stored.revision + 1,
    });
    return Promise.resolve();
  }
}

/** Versions are immutable: there is no way to change or remove one. */
export class InMemoryVersionRepository implements VersionRepository {
  constructor(private readonly store: DefinitionsStore) {}

  insert(_uow: UnitOfWork, version: FormVersion): Promise<"inserted" | "number_taken"> {
    requireUuid(version.id);
    this.store.requireForm(version.formId);
    if (this.store.versions.has(version.id)) {
      throw new Error(`fake store: version ${version.id} exists`);
    }
    for (const stored of this.store.versions.values()) {
      if (stored.formId === version.formId && stored.number === version.number) {
        return Promise.resolve("number_taken");
      }
    }
    this.store.versions.set(version.id, structuredClone(version));
    return Promise.resolve("inserted");
  }

  findById(id: string): Promise<FormVersion | null> {
    const version = UUID.test(id) ? this.store.versions.get(id) : undefined;
    return Promise.resolve(version ? structuredClone(version) : null);
  }

  findCurrent(formId: string): Promise<FormVersion | null> {
    const currentId = this.store.forms.get(formId)?.currentVersionId;
    const version = currentId ? this.store.versions.get(currentId) : undefined;
    return Promise.resolve(version ? structuredClone(version) : null);
  }

  latestNumber(formId: string): Promise<number> {
    let latest = 0;
    for (const version of this.store.versions.values()) {
      if (version.formId === formId) latest = Math.max(latest, version.number);
    }
    return Promise.resolve(latest);
  }
}

/** Scripted submission figures; see the file header. */
export class FakeSubmissionStats implements SubmissionStats {
  private readonly received = new Map<string, Date[]>();
  private readonly answers = new Map<string, Map<Key, number>>();

  receive(formId: string, ...at: Date[]): void {
    const list = this.received.get(formId) ?? [];
    list.push(...at.map((date) => new Date(date.getTime())));
    this.received.set(formId, list);
  }

  setAnswerCounts(formId: string, counts: Partial<Record<Key, number>>): void {
    const map = new Map<Key, number>();
    for (const [key, count] of Object.entries(counts)) {
      if (count !== undefined) map.set(key as Key, count);
    }
    this.answers.set(formId, map);
  }

  summary(formIds: readonly string[]): Promise<Map<string, SubmissionSummary>> {
    const result = new Map<string, SubmissionSummary>();
    for (const formId of formIds) {
      const dates = this.received.get(formId) ?? [];
      const last = dates.reduce<Date | null>(
        (latest, date) => (latest === null || date > latest ? date : latest),
        null,
      );
      result.set(formId, {
        total: dates.length,
        lastReceivedAt: last === null ? null : new Date(last.getTime()),
      });
    }
    return Promise.resolve(result);
  }

  countReceivedAfter(formId: string, after: Date): Promise<number> {
    const dates = this.received.get(formId) ?? [];
    return Promise.resolve(dates.filter((date) => date.getTime() > after.getTime()).length);
  }

  countOlderThan(formId: string, months: number, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime());
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    const dates = this.received.get(formId) ?? [];
    return Promise.resolve(dates.filter((date) => date.getTime() < cutoff.getTime()).length);
  }

  answerCounts(formId: string, keys: readonly Key[]): Promise<Map<Key, number>> {
    const scripted = this.answers.get(formId);
    return Promise.resolve(new Map(keys.map((key) => [key, scripted?.get(key) ?? 0] as const)));
  }

  hasAny(formId: string): Promise<boolean> {
    return Promise.resolve((this.received.get(formId)?.length ?? 0) > 0);
  }
}

export interface FakeDefinitionsDeps extends DefinitionsDeps {
  store: DefinitionsStore;
  forms: InMemoryFormRepository;
  drafts: InMemoryDraftRepository;
  versions: InMemoryVersionRepository;
  stats: FakeSubmissionStats;
  audit: InMemoryAuditLog;
  auditReader: InMemoryAuditLogReader;
  uow: FakeUnitOfWorkFactory;
  clock: FixedClock;
  ids: SequentialIdGenerator;
}

/** A full set of fakes; an override replaces one part, and the parts built after it use it. */
export function makeDefinitionsDeps(
  overrides: Partial<FakeDefinitionsDeps> = {},
): FakeDefinitionsDeps {
  const store = overrides.store ?? new DefinitionsStore();
  const clock = overrides.clock ?? new FixedClock();
  const audit = overrides.audit ?? new InMemoryAuditLog(assertNoPersonalData);
  return {
    store,
    forms: overrides.forms ?? new InMemoryFormRepository(store, clock),
    drafts: overrides.drafts ?? new InMemoryDraftRepository(store),
    versions: overrides.versions ?? new InMemoryVersionRepository(store),
    stats: overrides.stats ?? new FakeSubmissionStats(),
    audit,
    auditReader: overrides.auditReader ?? new InMemoryAuditLogReader(audit),
    uow: overrides.uow ?? new FakeUnitOfWorkFactory(),
    clock,
    ids: overrides.ids ?? new SequentialIdGenerator(),
    registry: overrides.registry ?? buildDefaultRegistry(),
    allowedRecipientDomains: overrides.allowedRecipientDomains ?? ["effluz.com"],
    publicBaseUrl: overrides.publicBaseUrl ?? "https://forms.example.com",
  };
}

/** The default acting editor in tests. */
export const EDITOR: Actor = { email: "editor@example.com", ip: "203.0.113.7" };

export interface SeedFormOptions extends Partial<CreateFormInput> {
  actor?: Actor;
  /** Columns written straight into the stored form after creation, for example a status. */
  patch?: Partial<Omit<Form, "id">>;
}

/** Creates a form with its draft through `createForm` and returns the id; throws when refused. */
export async function seedForm(
  deps: FakeDefinitionsDeps,
  options: SeedFormOptions = {},
): Promise<string> {
  const { actor = EDITOR, patch, ...input } = options;
  const result = await createForm(deps, actor, {
    title: { en: "Sample form", es: "Formulario de ejemplo" },
    languages: "bilingual",
    ...input,
  });
  if (!result.ok) throw new Error(`seedForm: createForm refused with ${result.code}`);
  if (patch) {
    const stored = deps.store.forms.get(result.formId);
    if (stored) deps.store.forms.set(result.formId, { ...stored, ...structuredClone(patch) });
  }
  return result.formId;
}
