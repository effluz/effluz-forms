import { describe, expect, it } from "vitest";
import type { Form } from "../domain/form";
import { updateSettings } from "./update-settings";
import {
  EDITOR,
  fakeUuid,
  makeDefinitionsDeps,
  seedForm,
  withConcurrentChange,
} from "./testing/fakes";

type Deps = ReturnType<typeof makeDefinitionsDeps>;

const VERSION_ID = fakeUuid(900);

/** A seeded form with its creation audit cleared; published when asked. */
async function seeded(deps: Deps, published = false): Promise<string> {
  const formId = await seedForm(deps, {
    patch: published
      ? { status: "published", currentVersionId: VERSION_ID, currentVersionNumber: 1 }
      : {},
  });
  deps.audit.entries.length = 0;
  return formId;
}

async function currentSettings(deps: Deps, formId: string) {
  const form = await deps.forms.findById(formId);
  if (!form) throw new Error("seeded form missing");
  return form.settings;
}

describe("updateSettings", () => {
  it("returns not_found for an unknown form", async () => {
    const deps = makeDefinitionsDeps();
    const result = await updateSettings(deps, EDITOR, {
      formId: fakeUuid(404),
      settings: { referencePrefix: "SF" },
    });
    expect(result).toEqual({ ok: false, code: "not_found" });
  });

  it("saves the settings and audits only the changed keys", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps);
    const before = await currentSettings(deps, formId);

    const result = await updateSettings(deps, EDITOR, {
      formId,
      settings: { ...before, notificationRecipients: ["Team@Effluz.com"], botChallenge: true },
    });

    expect(result).toEqual({ ok: true, changed: ["notificationRecipients", "botChallenge"] });
    const after = await currentSettings(deps, formId);
    expect(after.notificationRecipients).toEqual(["team@effluz.com"]);
    expect(after.botChallenge).toBe(true);
    expect(after.retentionMonths).toBe(before.retentionMonths);
    expect(deps.audit.entries).toEqual([
      {
        entry: {
          action: "form_settings_changed",
          actorEmail: EDITOR.email,
          targetId: formId,
          ip: EDITOR.ip,
          details: { keys: "notificationRecipients,botChallenge" },
        },
        at: deps.clock.now(),
      },
    ]);
  });

  it("stamps updatedAt with the clock when a setting changes", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps);
    const before = await currentSettings(deps, formId);
    deps.clock.advance(60_000);

    await updateSettings(deps, EDITOR, {
      formId,
      settings: { ...before, botChallenge: !before.botChallenge },
    });

    const form = await deps.forms.findById(formId);
    expect(form?.updatedAt).toEqual(deps.clock.now());
    expect(form?.updatedAt).not.toEqual(form?.createdAt);
  });

  it("writes nothing when no setting changed", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps);
    const before = await currentSettings(deps, formId);
    const updatedAt = (await deps.forms.findById(formId))?.updatedAt;
    deps.clock.advance(60_000);

    const result = await updateSettings(deps, EDITOR, { formId, settings: before });

    expect(result).toEqual({ ok: true, changed: [] });
    expect(deps.audit.entries).toEqual([]);
    expect((await deps.forms.findById(formId))?.updatedAt).toEqual(updatedAt);
  });

  it("rejects a recipient outside the allowed domains and a bad prefix with codes and paths", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps);
    const before = await currentSettings(deps, formId);

    const result = await updateSettings(deps, EDITOR, {
      formId,
      settings: {
        ...before,
        notificationRecipients: ["team@effluz.com", "someone@elsewhere.example"],
        referencePrefix: "toolongprefix",
      },
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid",
      issues: [
        { code: "recipient_domain", path: "notificationRecipients.1", params: { index: 1 } },
        { code: "prefix_format", path: "referencePrefix" },
      ],
    });
    expect(await currentSettings(deps, formId)).toEqual(before);
    expect(deps.audit.entries).toEqual([]);
  });

  it("maps schema failures to settings codes by path", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps);
    const before = await currentSettings(deps, formId);

    const result = await updateSettings(deps, EDITOR, {
      formId,
      settings: {
        ...before,
        notificationRecipients: Array.from({ length: 21 }, (_, i) => `r${String(i)}@effluz.com`),
        retentionMonths: 1.5,
        digestHour: 24,
        referencePrefix: 7,
        timezone: 3,
      },
    });

    if (result.ok || result.code !== "invalid") throw new Error("expected invalid");
    expect(result.issues).toEqual([
      {
        code: "too_many_recipients",
        path: "notificationRecipients",
        params: { max: 20 },
      },
      { code: "hour_range", path: "digestHour" },
      { code: "timezone_unknown", path: "timezone" },
      { code: "prefix_format", path: "referencePrefix" },
      { code: "retention_range", path: "retentionMonths", params: { min: 1, max: 36 } },
    ]);
  });

  it("reports an unreadable recipient as recipient_syntax at its index", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps);
    const before = await currentSettings(deps, formId);

    const result = await updateSettings(deps, EDITOR, {
      formId,
      settings: { ...before, notificationRecipients: ["team@effluz.com", 5] },
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid",
      issues: [
        { code: "recipient_syntax", path: "notificationRecipients.1", params: { index: 1 } },
      ],
    });
  });

  it("reports tampered fixed controls and dates as malformed at their paths", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps);
    const before = await currentSettings(deps, formId);

    const result = await updateSettings(deps, EDITOR, {
      formId,
      settings: {
        ...before,
        notificationCadence: "weekly",
        botChallenge: "yes",
        opensAt: "tomorrow",
      },
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid",
      issues: [
        { code: "malformed", path: "notificationCadence" },
        { code: "malformed", path: "opensAt" },
        { code: "malformed", path: "botChallenge" },
      ],
    });
    expect(await currentSettings(deps, formId)).toEqual(before);
    expect(deps.audit.entries).toEqual([]);
  });

  it("reports a non-numeric hour, a bad closing date and a non-object payload as malformed", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps);
    const before = await currentSettings(deps, formId);

    expect(
      await updateSettings(deps, EDITOR, {
        formId,
        settings: { ...before, digestHour: "nine", allowAnotherResponse: 1, closesAt: 5 },
      }),
    ).toEqual({
      ok: false,
      code: "invalid",
      issues: [
        { code: "malformed", path: "digestHour" },
        { code: "malformed", path: "closesAt" },
        { code: "malformed", path: "allowAnotherResponse" },
      ],
    });
    expect(await updateSettings(deps, EDITOR, { formId, settings: "nope" })).toEqual({
      ok: false,
      code: "invalid",
      issues: [{ code: "malformed", path: "" }],
    });
  });

  it("saves a slug change on a never-published form and lists it in changed", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps);
    const before = await currentSettings(deps, formId);

    const result = await updateSettings(deps, EDITOR, {
      formId,
      settings: before,
      slug: "renamed-form",
    });

    expect(result).toEqual({ ok: true, changed: ["slug"] });
    expect((await deps.forms.findById(formId))?.slug).toBe("renamed-form");
    expect(deps.audit.entries.map((e) => e.entry.details)).toEqual([{ keys: "slug" }]);
  });

  it("refuses a slug change on a published form with slug_locked", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps, true);
    const before = await currentSettings(deps, formId);

    const result = await updateSettings(deps, EDITOR, {
      formId,
      settings: before,
      slug: "renamed-form",
    });

    expect(result).toEqual({ ok: false, code: "slug_locked" });
    expect((await deps.forms.findById(formId))?.slug).toBe("sample-form");
    expect(deps.audit.entries).toEqual([]);
  });

  it("accepts the unchanged slug on a published form", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps, true);
    const before = await currentSettings(deps, formId);

    const result = await updateSettings(deps, EDITOR, {
      formId,
      settings: { ...before, allowAnotherResponse: true },
      slug: "sample-form",
    });

    expect(result).toEqual({ ok: true, changed: ["allowAnotherResponse"] });
  });

  it.each([
    ["ab", "slug_format"],
    ["admin", "slug_reserved"],
  ] as const)("refuses the slug %s with %s", async (slug, code) => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps);
    const before = await currentSettings(deps, formId);

    const result = await updateSettings(deps, EDITOR, { formId, settings: before, slug });

    expect(result).toEqual({ ok: false, code });
  });

  it("returns slug_taken when another form owns the slug and writes no audit", async () => {
    const deps = makeDefinitionsDeps();
    await seedForm(deps, { slug: "taken-slug" });
    const formId = await seeded(deps);
    const before = await currentSettings(deps, formId);

    const result = await updateSettings(deps, EDITOR, {
      formId,
      settings: before,
      slug: "taken-slug",
    });

    expect(result).toEqual({ ok: false, code: "slug_taken" });
    expect((await deps.forms.findById(formId))?.slug).toBe("sample-form");
    expect(deps.audit.entries).toEqual([]);
  });

  it("refuses a prefix change once the form has submissions", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps, true);
    deps.stats.receive(formId, new Date("2026-10-01T00:00:00Z"));
    const before = await currentSettings(deps, formId);

    const result = await updateSettings(deps, EDITOR, {
      formId,
      settings: { ...before, referencePrefix: "NEW" },
    });

    expect(result).toEqual({ ok: false, code: "prefix_locked" });
    expect((await currentSettings(deps, formId)).referencePrefix).toBe(before.referencePrefix);
    expect(deps.audit.entries).toEqual([]);
  });

  it("allows a prefix change before the first submission", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await seeded(deps, true);
    const before = await currentSettings(deps, formId);

    const result = await updateSettings(deps, EDITOR, {
      formId,
      settings: { ...before, referencePrefix: "NEW" },
    });

    expect(result).toEqual({ ok: true, changed: ["referencePrefix"] });
  });

  describe("shortening retention", () => {
    /** Clock at 2026-10-10; three submissions older than six months, one recent. */
    async function withSubmissions(deps: Deps) {
      const formId = await seeded(deps, true);
      deps.stats.receive(
        formId,
        new Date("2026-01-05T00:00:00Z"),
        new Date("2026-02-05T00:00:00Z"),
        new Date("2026-03-05T00:00:00Z"),
        new Date("2026-09-30T00:00:00Z"),
      );
      return formId;
    }

    it("asks for confirmation with the number of submissions it would purge", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await withSubmissions(deps);
      const before = await currentSettings(deps, formId);

      const result = await updateSettings(deps, EDITOR, {
        formId,
        settings: { ...before, retentionMonths: 6 },
      });

      expect(result).toEqual({ ok: false, code: "retention_confirm", count: 3 });
      expect((await currentSettings(deps, formId)).retentionMonths).toBe(12);
      expect(deps.audit.entries).toEqual([]);
    });

    it("saves on confirmation and audits retention_shortened with the count", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await withSubmissions(deps);
      const before = await currentSettings(deps, formId);

      const result = await updateSettings(deps, EDITOR, {
        formId,
        settings: { ...before, retentionMonths: 6 },
        confirmRetentionPurge: true,
      });

      expect(result).toEqual({ ok: true, changed: ["retentionMonths"] });
      expect((await currentSettings(deps, formId)).retentionMonths).toBe(6);
      const base = { actorEmail: EDITOR.email, targetId: formId, ip: EDITOR.ip };
      expect(deps.audit.entries).toEqual([
        {
          entry: { ...base, action: "form_settings_changed", details: { keys: "retentionMonths" } },
          at: deps.clock.now(),
        },
        {
          entry: { ...base, action: "retention_shortened", details: { from: 12, to: 6, count: 3 } },
          at: deps.clock.now(),
        },
      ]);
    });

    it("needs no confirmation and writes no retention_shortened when nothing is affected", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await withSubmissions(deps);
      const before = await currentSettings(deps, formId);

      const result = await updateSettings(deps, EDITOR, {
        formId,
        settings: { ...before, retentionMonths: 10 },
      });

      expect(result).toEqual({ ok: true, changed: ["retentionMonths"] });
      expect(deps.audit.entries.map((e) => e.entry.action)).toEqual(["form_settings_changed"]);
    });

    it("needs no confirmation when retention grows", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await withSubmissions(deps);
      const before = await currentSettings(deps, formId);

      const result = await updateSettings(deps, EDITOR, {
        formId,
        settings: { ...before, retentionMonths: 24 },
      });

      expect(result).toEqual({ ok: true, changed: ["retentionMonths"] });
      expect(deps.audit.entries.map((e) => e.entry.action)).toEqual(["form_settings_changed"]);
    });
  });

  describe("when another actor commits between the read and the lock", () => {
    /** Rewrites the stored form once, just before the use case locks it. */
    function changeForm(deps: Deps, formId: string, patch: (form: Form) => Partial<Form>) {
      return withConcurrentChange(deps.forms, () => {
        const stored = deps.store.forms.get(formId);
        if (!stored) throw new Error("no form");
        deps.store.forms.set(formId, { ...stored, ...patch(stored) });
      });
    }

    /** Rewrites the stored retention and returns the stored settings. */
    function storeRetention(deps: Deps, formId: string, retentionMonths: number) {
      const stored = deps.store.forms.get(formId);
      if (!stored) throw new Error("no form");
      const settings = { ...stored.settings, retentionMonths };
      deps.store.forms.set(formId, { ...stored, settings });
      return settings;
    }

    it("keeps a status change made meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await seeded(deps, true);
      const before = await currentSettings(deps, formId);
      const forms = changeForm(deps, formId, () => ({ status: "closed" }));

      const result = await updateSettings({ ...deps, forms }, EDITOR, {
        formId,
        settings: { ...before, botChallenge: true },
      });

      expect(result).toEqual({ ok: true, changed: ["botChallenge"] });
      expect(deps.store.forms.get(formId)).toMatchObject({
        status: "closed",
        settings: { botChallenge: true },
      });
    });

    it("lists only the keys that differ from the fresh settings", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await seeded(deps);
      const before = await currentSettings(deps, formId);
      const forms = changeForm(deps, formId, (form) => ({
        settings: { ...form.settings, botChallenge: true },
      }));

      const result = await updateSettings({ ...deps, forms }, EDITOR, {
        formId,
        settings: { ...before, botChallenge: true, allowAnotherResponse: true },
      });

      expect(result).toEqual({ ok: true, changed: ["allowAnotherResponse"] });
      expect(deps.audit.entries.map((e) => e.entry.details)).toEqual([
        { keys: "allowAnotherResponse" },
      ]);
    });

    it("refuses a slug change with slug_locked when the form was published meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await seeded(deps);
      const before = await currentSettings(deps, formId);
      const forms = changeForm(deps, formId, () => ({
        status: "published",
        currentVersionId: VERSION_ID,
        currentVersionNumber: 1,
      }));

      const result = await updateSettings({ ...deps, forms }, EDITOR, {
        formId,
        settings: before,
        slug: "renamed-form",
      });

      expect(result).toEqual({ ok: false, code: "slug_locked" });
      expect(deps.store.forms.get(formId)?.slug).toBe("sample-form");
      expect(deps.audit.entries).toEqual([]);
    });

    it("asks for confirmation when retention was lengthened meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await seeded(deps, true);
      deps.stats.receive(
        formId,
        new Date("2026-01-05T00:00:00Z"),
        new Date("2026-09-30T00:00:00Z"),
      );
      const before = storeRetention(deps, formId, 6);
      const forms = changeForm(deps, formId, (form) => ({
        settings: { ...form.settings, retentionMonths: 12 },
      }));

      const result = await updateSettings({ ...deps, forms }, EDITOR, {
        formId,
        settings: { ...before, botChallenge: true },
      });

      expect(result).toEqual({ ok: false, code: "retention_confirm", count: 1 });
      expect(deps.store.forms.get(formId)?.settings).toMatchObject({
        retentionMonths: 12,
        botChallenge: false,
      });
      expect(deps.audit.entries).toEqual([]);
    });

    it("audits retention_shortened with the locked count once confirmed", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await seeded(deps, true);
      deps.stats.receive(
        formId,
        new Date("2026-01-05T00:00:00Z"),
        new Date("2026-09-30T00:00:00Z"),
      );
      const before = storeRetention(deps, formId, 6);
      const forms = changeForm(deps, formId, (form) => ({
        settings: { ...form.settings, retentionMonths: 12 },
      }));

      const result = await updateSettings({ ...deps, forms }, EDITOR, {
        formId,
        settings: { ...before, botChallenge: true },
        confirmRetentionPurge: true,
      });

      expect(result).toEqual({ ok: true, changed: ["retentionMonths", "botChallenge"] });
      expect(deps.audit.entries.map((e) => e.entry)).toContainEqual({
        action: "retention_shortened",
        actorEmail: EDITOR.email,
        targetId: formId,
        ip: EDITOR.ip,
        details: { from: 12, to: 6, count: 1 },
      });
    });

    it("refuses a prefix change with prefix_locked when the first submission landed meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await seeded(deps, true);
      const before = await currentSettings(deps, formId);
      const forms = withConcurrentChange(deps.forms, () => {
        deps.stats.receive(formId, new Date("2026-10-09T00:00:00Z"));
      });

      const result = await updateSettings({ ...deps, forms }, EDITOR, {
        formId,
        settings: { ...before, referencePrefix: "NEW" },
      });

      expect(result).toEqual({ ok: false, code: "prefix_locked" });
      expect(deps.store.forms.get(formId)?.settings.referencePrefix).toBe(before.referencePrefix);
      expect(deps.audit.entries).toEqual([]);
    });

    it("returns not_found when the form was deleted meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await seeded(deps);
      const before = await currentSettings(deps, formId);
      const forms = withConcurrentChange(deps.forms, () => {
        deps.store.forms.delete(formId);
        deps.store.drafts.delete(formId);
      });

      const result = await updateSettings({ ...deps, forms }, EDITOR, {
        formId,
        settings: { ...before, botChallenge: true },
      });

      expect(result).toEqual({ ok: false, code: "not_found" });
      expect(deps.audit.entries).toEqual([]);
    });
  });
});
