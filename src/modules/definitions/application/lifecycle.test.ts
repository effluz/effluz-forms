import { describe, expect, it } from "vitest";
import {
  AUDIT_FOR_ACTION,
  FORM_STATUSES,
  LIFECYCLE_ACTIONS,
  nextStatus,
  type Form,
  type FormStatus,
  type LifecycleAction,
} from "../domain/form";
import { applyLifecycle, deleteForm } from "./lifecycle";
import {
  EDITOR,
  fakeUuid,
  makeDefinitionsDeps,
  seedForm,
  withConcurrentChange,
} from "./testing/fakes";

const VERSION_ID = fakeUuid(900);

/** A seeded form in `status`, with a current version when `everPublished`. */
async function seeded(
  deps: ReturnType<typeof makeDefinitionsDeps>,
  status: FormStatus,
  everPublished: boolean,
) {
  const formId = await seedForm(deps, {
    patch: {
      status,
      currentVersionId: everPublished ? VERSION_ID : null,
      currentVersionNumber: everPublished ? 1 : null,
      ...(status === "archived" ? { archivedAt: new Date("2026-09-01T00:00:00Z") } : {}),
    },
  });
  deps.audit.entries.length = 0;
  return formId;
}

describe("applyLifecycle matrix", () => {
  const cases = FORM_STATUSES.flatMap((status) =>
    LIFECYCLE_ACTIONS.flatMap((action) =>
      [false, true].map((everPublished) => ({ status, action, everPublished })),
    ),
  );

  it.each(cases)(
    "$action on $status (ever published: $everPublished) follows the lifecycle rules",
    async ({ status, action, everPublished }) => {
      const deps = makeDefinitionsDeps();
      const formId = await seeded(deps, status, everPublished);
      const expected = nextStatus(status, action, { everPublished });

      const result = await applyLifecycle(deps, EDITOR, { formId, action });

      if (expected === null) {
        expect(result).toEqual({ ok: false, code: "invalid_transition" });
        expect(deps.audit.entries).toEqual([]);
        expect((await deps.forms.findById(formId))?.status).toBe(status);
        return;
      }
      expect(result).toEqual({ ok: true, status: expected });
      expect((await deps.forms.findById(formId))?.status).toBe(expected);
      expect(deps.audit.entries).toEqual([
        {
          entry: {
            action: AUDIT_FOR_ACTION[action],
            actorEmail: EDITOR.email,
            targetId: formId,
            ip: EDITOR.ip,
          },
          at: deps.clock.now(),
        },
      ]);
    },
  );

  it("has valid transitions to exercise", () => {
    const valid = cases.filter((c) => nextStatus(c.status, c.action, c) !== null);
    expect(valid.length).toBeGreaterThanOrEqual(LIFECYCLE_ACTIONS.length);
  });
});

describe("applyLifecycle", () => {
  it("returns not_found for an unknown form and audits nothing", async () => {
    const deps = makeDefinitionsDeps();
    const result = await applyLifecycle(deps, EDITOR, {
      formId: fakeUuid(404),
      action: "close",
    });
    expect(result).toEqual({ ok: false, code: "not_found" });
    expect(deps.audit.entries).toEqual([]);
  });

  it("records archivedAt when a published form is archived", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps, "published", true);
    await applyLifecycle(deps, EDITOR, { formId, action: "archive" });
    expect((await deps.forms.findById(formId))?.archivedAt).toEqual(deps.clock.now());
  });

  it("stamps updatedAt with the clock when the status changes", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps, "published", true);
    deps.clock.advance(60_000);

    await applyLifecycle(deps, EDITOR, { formId, action: "close" });

    const form = await deps.forms.findById(formId);
    expect(form?.updatedAt).toEqual(deps.clock.now());
    expect(form?.updatedAt).not.toEqual(form?.createdAt);
  });

  it("clears archivedAt on unarchive and lands a published form on closed", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps, "archived", true);
    const result = await applyLifecycle(deps, EDITOR, { formId, action: "unarchive" });
    expect(result).toEqual({ ok: true, status: "closed" });
    expect((await deps.forms.findById(formId))?.archivedAt).toBeNull();
  });

  it("returns a never-published archived form to draft on unarchive", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps, "archived", false);
    const result = await applyLifecycle(deps, EDITOR, { formId, action: "unarchive" });
    expect(result).toEqual({ ok: true, status: "draft" });
    expect((await deps.forms.findById(formId))?.archivedAt).toBeNull();
  });

  it.each<LifecycleAction>(["close", "reopen"])(
    "leaves archivedAt untouched on %s",
    async (action) => {
      const deps = makeDefinitionsDeps();
      const formId = await seeded(deps, action === "close" ? "published" : "closed", true);
      await applyLifecycle(deps, EDITOR, { formId, action });
      expect((await deps.forms.findById(formId))?.archivedAt).toBeNull();
    },
  );

  it("changes nothing but the status on close", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps, "published", true);
    const before = await deps.forms.findById(formId);
    await applyLifecycle(deps, EDITOR, { formId, action: "close" });
    const after = await deps.forms.findById(formId);
    expect({ ...after, status: before?.status, updatedAt: before?.updatedAt }).toEqual(before);
  });

  describe("when another actor commits between the read and the lock", () => {
    it("returns invalid_transition when the form was already closed meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await seeded(deps, "published", true);
      const forms = changeForm(deps, formId, { status: "closed" });

      const result = await applyLifecycle({ ...deps, forms }, EDITOR, { formId, action: "close" });

      expect(result).toEqual({ ok: false, code: "invalid_transition" });
      expect(deps.audit.entries).toEqual([]);
    });

    it("keeps a settings change made meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await seeded(deps, "published", true);
      const settings = deps.store.forms.get(formId)?.settings;
      if (!settings) throw new Error("no form");
      const forms = changeForm(deps, formId, { settings: { ...settings, botChallenge: true } });

      const result = await applyLifecycle({ ...deps, forms }, EDITOR, {
        formId,
        action: "archive",
      });

      expect(result).toEqual({ ok: true, status: "archived" });
      expect(deps.store.forms.get(formId)).toMatchObject({
        status: "archived",
        settings: { botChallenge: true },
      });
    });
  });
});

/** Rewrites the stored form once, just before the use case locks it. */
function changeForm(
  deps: ReturnType<typeof makeDefinitionsDeps>,
  formId: string,
  patch: Partial<Form>,
) {
  return withConcurrentChange(deps.forms, () => {
    const stored = deps.store.forms.get(formId);
    if (!stored) throw new Error("no form");
    deps.store.forms.set(formId, { ...stored, ...patch });
  });
}

describe("deleteForm", () => {
  it("deletes an unpublished form without submissions, with its draft, and audits the slug", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seedForm(deps);
    deps.audit.entries.length = 0;

    const result = await deleteForm(deps, EDITOR, { formId, slugConfirmation: "sample-form" });

    expect(result).toEqual({ ok: true });
    expect(await deps.forms.findById(formId)).toBeNull();
    expect(await deps.drafts.find(formId)).toBeNull();
    expect(deps.audit.entries).toEqual([
      {
        entry: {
          action: "form_deleted",
          actorEmail: EDITOR.email,
          targetId: formId,
          ip: EDITOR.ip,
          details: { slug: "sample-form" },
        },
        at: deps.clock.now(),
      },
    ]);
  });

  it("deletes an archived form that was never published", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps, "archived", false);
    expect(await deleteForm(deps, EDITOR, { formId, slugConfirmation: "sample-form" })).toEqual({
      ok: true,
    });
  });

  it("returns not_found for an unknown form", async () => {
    const deps = makeDefinitionsDeps();
    const result = await deleteForm(deps, EDITOR, {
      formId: fakeUuid(404),
      slugConfirmation: "anything",
    });
    expect(result).toEqual({ ok: false, code: "not_found" });
    expect(deps.audit.entries).toEqual([]);
  });

  it("refuses a form that was ever published", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps, "published", true);
    const result = await deleteForm(deps, EDITOR, { formId, slugConfirmation: "sample-form" });
    expect(result).toEqual({ ok: false, code: "not_allowed" });
    expect(await deps.forms.findById(formId)).not.toBeNull();
    expect(deps.audit.entries).toEqual([]);
  });

  it("refuses a draft form that has submissions", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seedForm(deps);
    deps.stats.receive(formId, deps.clock.now());
    deps.audit.entries.length = 0;
    const result = await deleteForm(deps, EDITOR, { formId, slugConfirmation: "sample-form" });
    expect(result).toEqual({ ok: false, code: "not_allowed" });
    expect(await deps.forms.findById(formId)).not.toBeNull();
    expect(deps.audit.entries).toEqual([]);
  });

  it.each(["", "sample", "Sample-Form", " sample-form", "sample-form "])(
    "refuses the wrong confirmation %j and keeps the form",
    async (slugConfirmation) => {
      const deps = makeDefinitionsDeps();
      const formId = await seedForm(deps);
      deps.audit.entries.length = 0;
      const result = await deleteForm(deps, EDITOR, { formId, slugConfirmation });
      expect(result).toEqual({ ok: false, code: "slug_mismatch" });
      expect(await deps.forms.findById(formId)).not.toBeNull();
      expect(await deps.drafts.find(formId)).not.toBeNull();
      expect(deps.audit.entries).toEqual([]);
    },
  );

  describe("when another actor commits between the read and the lock", () => {
    it("refuses with not_allowed when the form was published meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await seedForm(deps);
      deps.audit.entries.length = 0;
      const forms = changeForm(deps, formId, {
        status: "published",
        currentVersionId: VERSION_ID,
        currentVersionNumber: 1,
      });

      const result = await deleteForm({ ...deps, forms }, EDITOR, {
        formId,
        slugConfirmation: "sample-form",
      });

      expect(result).toEqual({ ok: false, code: "not_allowed" });
      expect(deps.store.forms.has(formId)).toBe(true);
      expect(deps.audit.entries).toEqual([]);
    });

    it("refuses with slug_mismatch when the slug changed meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await seedForm(deps);
      deps.audit.entries.length = 0;
      const forms = changeForm(deps, formId, { slug: "renamed-form" });

      const result = await deleteForm({ ...deps, forms }, EDITOR, {
        formId,
        slugConfirmation: "sample-form",
      });

      expect(result).toEqual({ ok: false, code: "slug_mismatch" });
      expect(deps.store.forms.has(formId)).toBe(true);
      expect(deps.audit.entries).toEqual([]);
    });

    it("returns not_found when the form was deleted meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await seedForm(deps);
      deps.audit.entries.length = 0;
      const forms = withConcurrentChange(deps.forms, () => {
        deps.store.forms.delete(formId);
        deps.store.drafts.delete(formId);
      });

      const result = await deleteForm({ ...deps, forms }, EDITOR, {
        formId,
        slugConfirmation: "sample-form",
      });

      expect(result).toEqual({ ok: false, code: "not_found" });
      expect(deps.audit.entries).toEqual([]);
    });
  });
});
