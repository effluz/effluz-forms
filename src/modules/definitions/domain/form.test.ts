import { describe, expect, it } from "vitest";
import {
  AUDIT_FOR_ACTION,
  FORM_STATUSES,
  LIFECYCLE_ACTIONS,
  canDelete,
  canEditSlug,
  nextStatus,
  reachability,
  type Form,
  type FormStatus,
  type LifecycleAction,
} from "./form";
import { defaultSettings, type FormSettings } from "./settings";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function makeForm(overrides: Partial<Form> = {}): Form {
  return {
    id: "form-1",
    slug: "summer-camp",
    title: { en: "Summer camp", es: "Campamento de verano" },
    languages: "bilingual",
    status: "published",
    settings: defaultSettings("summer-camp"),
    currentVersionId: "version-1",
    currentVersionNumber: 1,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const withSettings = (patch: Partial<FormSettings>): FormSettings => ({
  ...defaultSettings("summer-camp"),
  ...patch,
});

const neverPublished = (): Form =>
  makeForm({ status: "draft", currentVersionId: null, currentVersionNumber: null });

describe("nextStatus", () => {
  const matrix: Record<LifecycleAction, Partial<Record<FormStatus, FormStatus>>> = {
    close: { published: "closed" },
    reopen: { closed: "published" },
    archive: { draft: "archived", published: "archived", closed: "archived" },
    unarchive: { archived: "closed" },
  };

  for (const action of LIFECYCLE_ACTIONS)
    for (const status of FORM_STATUSES) {
      const expected = matrix[action][status] ?? null;
      it(`${action} from ${status} gives ${String(expected)}`, () => {
        expect(nextStatus(status, action)).toBe(expected);
      });
    }

  it("maps every lifecycle action to its audit action", () => {
    expect(AUDIT_FOR_ACTION).toEqual({
      close: "form_closed",
      reopen: "form_reopened",
      archive: "form_archived",
      unarchive: "form_unarchived",
    });
  });
});

describe("canDelete and canEditSlug", () => {
  it("allows deleting a never-published form without submissions", () => {
    expect(canDelete(neverPublished(), false)).toBe(true);
  });

  it("refuses deleting a form with submissions", () => {
    expect(canDelete(neverPublished(), true)).toBe(false);
  });

  it("refuses deleting a form that was published", () => {
    expect(canDelete(makeForm(), false)).toBe(false);
  });

  it("lets the slug change only before the first publish", () => {
    expect(canEditSlug(neverPublished())).toBe(true);
    expect(canEditSlug(makeForm())).toBe(false);
  });
});

describe("reachability", () => {
  it("is reachable when published with no window", () => {
    expect(reachability(makeForm(), NOW)).toEqual({ reachable: true });
  });

  it("reports archived and closed by status", () => {
    expect(reachability(makeForm({ status: "archived" }), NOW)).toEqual({
      reachable: false,
      reason: "archived",
    });
    expect(reachability(makeForm({ status: "closed" }), NOW)).toEqual({
      reachable: false,
      reason: "closed",
    });
  });

  it("reports draft when never published", () => {
    expect(reachability(neverPublished(), NOW)).toEqual({ reachable: false, reason: "draft" });
  });

  it("reports not_open_yet before opensAt", () => {
    const form = makeForm({ settings: withSettings({ opensAt: "2026-07-01T00:00:00.000Z" }) });
    expect(reachability(form, NOW)).toEqual({ reachable: false, reason: "not_open_yet" });
  });

  it("reports past_close after closesAt", () => {
    const form = makeForm({ settings: withSettings({ closesAt: "2026-06-01T00:00:00.000Z" }) });
    expect(reachability(form, NOW)).toEqual({ reachable: false, reason: "past_close" });
  });

  it("is reachable inside the window", () => {
    const form = makeForm({
      settings: withSettings({
        opensAt: "2026-06-01T00:00:00.000Z",
        closesAt: "2026-07-01T00:00:00.000Z",
      }),
    });
    expect(reachability(form, NOW)).toEqual({ reachable: true });
  });
});
