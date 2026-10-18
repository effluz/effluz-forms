import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { copy, type CopyKey } from "@/shared/presentation/copy";
import type { Form } from "../application";
import { settingsSchema, type SettingsCode } from "../domain/settings";
import { SettingsForm, type SettingsFormProps } from "./SettingsForm";
import {
  decodeSettingsState,
  encodeSettingsState,
  issueCopy,
  parseSettingsForm,
  readSettingsValues,
  settingsValues,
  TIMEZONES,
  utcToZonedInput,
  zonedTimeToUtc,
} from "./settings-form";

const FORM_ID = "00000001-0000-4000-8000-000000000001";

function form(overrides: Partial<Form> = {}, settings: Partial<Form["settings"]> = {}): Form {
  return {
    id: FORM_ID,
    slug: "spring-stories",
    title: { en: "Spring stories", es: "Historias de primavera" },
    languages: "bilingual",
    status: "draft",
    settings: {
      notificationRecipients: ["team@effluz.com", "ops@effluz.com"],
      notificationCadence: "per_submission",
      digestHour: 9,
      timezone: "America/Panama",
      referencePrefix: "SS",
      retentionMonths: 12,
      botChallenge: false,
      allowAnotherResponse: false,
      usePostPlan: false,
      ...settings,
    },
    currentVersionId: null,
    currentVersionNumber: null,
    archivedAt: null,
    createdAt: new Date("2026-10-01T12:00:00Z"),
    updatedAt: new Date("2026-10-01T12:00:00Z"),
    ...overrides,
  };
}

function posted(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const FILLED = {
  csrf: "csrf-token-1",
  notificationRecipients: "Team@Effluz.com\r\n\n  ops@effluz.com  \n",
  notificationCadence: "daily",
  digestHour: "7",
  timezone: "America/Panama",
  retentionMonths: "18",
  referencePrefix: " spr ",
  opensAt: "2026-11-01T09:00",
  closesAt: "",
  botChallenge: "on",
  slug: "  spring-2026 ",
};

describe("zonedTimeToUtc", () => {
  it("reads a local time in Panama, which has no daylight saving", () => {
    expect(zonedTimeToUtc("2026-11-01T09:00", "America/Panama")).toBe("2026-11-01T14:00:00.000Z");
    expect(zonedTimeToUtc("2026-07-01T09:00", "America/Panama")).toBe("2026-07-01T14:00:00.000Z");
  });

  it("follows Madrid across the end of summer time", () => {
    expect(zonedTimeToUtc("2026-10-24T09:00", "Europe/Madrid")).toBe("2026-10-24T07:00:00.000Z");
    expect(zonedTimeToUtc("2026-10-26T09:00", "Europe/Madrid")).toBe("2026-10-26T08:00:00.000Z");
  });

  it("follows Madrid across the start of summer time", () => {
    expect(zonedTimeToUtc("2026-03-28T09:00", "Europe/Madrid")).toBe("2026-03-28T08:00:00.000Z");
    expect(zonedTimeToUtc("2026-03-30T09:00", "Europe/Madrid")).toBe("2026-03-30T07:00:00.000Z");
  });

  it("moves a time skipped by the clock change forward, and takes the later of a repeated one", () => {
    // 02:30 does not exist on 29 March in Madrid; it reads as 03:30 summer time.
    expect(zonedTimeToUtc("2026-03-29T02:30", "Europe/Madrid")).toBe("2026-03-29T01:30:00.000Z");
    // 02:30 happens twice on 25 October; the second one is winter time.
    expect(zonedTimeToUtc("2026-10-25T02:30", "Europe/Madrid")).toBe("2026-10-25T01:30:00.000Z");
  });

  it("accepts seconds and refuses what is not a local date and time", () => {
    expect(zonedTimeToUtc("2026-11-01T09:00:30", "America/Panama")).toBe(
      "2026-11-01T14:00:30.000Z",
    );
    for (const value of ["", "tomorrow", "2026-02-30T09:00", "2026-11-01T24:00", "2026-11-01"]) {
      expect(zonedTimeToUtc(value, "America/Panama")).toBeNull();
    }
    expect(zonedTimeToUtc("2026-11-01T09:00", "Mars/Olympus")).toBeNull();
  });
});

describe("utcToZonedInput", () => {
  it("gives the datetime-local value in the zone, the inverse of zonedTimeToUtc", () => {
    expect(utcToZonedInput("2026-11-01T14:00:00.000Z", "America/Panama")).toBe("2026-11-01T09:00");
    expect(utcToZonedInput("2026-10-26T08:00:00Z", "Europe/Madrid")).toBe("2026-10-26T09:00");
    expect(utcToZonedInput("2026-10-24T07:00:00Z", "Europe/Madrid")).toBe("2026-10-24T09:00");
  });
});

describe("parseSettingsForm", () => {
  it("builds the settings the use case parses from a filled form", () => {
    const result = parseSettingsForm(posted(FILLED), "America/Panama");
    expect(result).toEqual({
      settings: {
        notificationRecipients: ["Team@Effluz.com", "ops@effluz.com"],
        notificationCadence: "daily",
        digestHour: 7,
        timezone: "America/Panama",
        referencePrefix: "SPR",
        retentionMonths: 18,
        opensAt: "2026-11-01T14:00:00.000Z",
        botChallenge: true,
        allowAnotherResponse: false,
        usePostPlan: false,
      },
      slug: "spring-2026",
      confirm: false,
    });
    expect(settingsSchema.safeParse(result.settings).success).toBe(true);
  });

  it("reads the dates in the zone chosen on the form", () => {
    const { settings } = parseSettingsForm(
      posted({ ...FILLED, timezone: "Europe/Madrid", closesAt: "2026-10-26T09:00" }),
      "America/Panama",
    );
    expect(settings).toMatchObject({
      opensAt: "2026-11-01T08:00:00.000Z",
      closesAt: "2026-10-26T08:00:00.000Z",
    });
  });

  it("falls back to the given zone for the dates when the posted zone is unknown", () => {
    const { settings } = parseSettingsForm(
      posted({ ...FILLED, timezone: "Mars/Olympus" }),
      "America/Panama",
    );
    expect(settings).toMatchObject({
      timezone: "Mars/Olympus",
      opensAt: "2026-11-01T14:00:00.000Z",
    });
  });

  it("leaves the slug out when the field was not posted, and reads the purge confirmation", () => {
    const withoutSlug = Object.fromEntries(Object.entries(FILLED).filter(([n]) => n !== "slug"));
    const result = parseSettingsForm(
      posted({ ...withoutSlug, confirmRetentionPurge: "1" }),
      "America/Panama",
    );
    expect(result.slug).toBeUndefined();
    expect(result.confirm).toBe(true);
  });

  it("passes unreadable values through, so the use case reports them on their paths", () => {
    const { settings } = parseSettingsForm(
      posted({ ...FILLED, retentionMonths: "", digestHour: "noon", opensAt: "soon" }),
      "America/Panama",
    );
    const parsed = settingsSchema.safeParse(settings);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "digestHour",
      "retentionMonths",
      "opensAt",
    ]);
  });

  it("gives an empty recipient list for an empty text area", () => {
    const { settings } = parseSettingsForm(
      posted({ ...FILLED, notificationRecipients: " \n " }),
      "America/Panama",
    );
    expect(settings).toMatchObject({ notificationRecipients: [] });
  });
});

describe("settingsValues", () => {
  it("shows the stored settings as field values, dates in the form's zone", () => {
    const values = settingsValues(
      form({}, { opensAt: "2026-11-01T14:00:00.000Z", botChallenge: true }),
    );
    expect(values).toEqual({
      recipients: "team@effluz.com\nops@effluz.com",
      cadence: "per_submission",
      digestHour: "9",
      timezone: "America/Panama",
      retentionMonths: "12",
      referencePrefix: "SS",
      opensAt: "2026-11-01T09:00",
      closesAt: "",
      botChallenge: true,
      allowAnotherResponse: false,
      usePostPlan: false,
      slug: "spring-stories",
    });
  });

  it("round-trips through the posted form", () => {
    const values = readSettingsValues(posted(FILLED));
    expect(values).toMatchObject({
      recipients: FILLED.notificationRecipients,
      cadence: "daily",
      botChallenge: true,
      allowAnotherResponse: false,
      slug: FILLED.slug,
    });
  });

  it("reads and writes the post-plan toggle", () => {
    expect(readSettingsValues(posted({ ...FILLED, usePostPlan: "on" })).usePostPlan).toBe(true);
    expect(readSettingsValues(posted(FILLED)).usePostPlan).toBe(false);
    expect(
      parseSettingsForm(posted({ ...FILLED, usePostPlan: "on" }), "America/Panama").settings,
    ).toMatchObject({ usePostPlan: true });
    expect(parseSettingsForm(posted(FILLED), "America/Panama").settings).toMatchObject({
      usePostPlan: false,
    });
    expect(settingsValues(form({}, { usePostPlan: true })).usePostPlan).toBe(true);
  });
});

describe("issueCopy", () => {
  it("names a manager copy row for every settings issue code", () => {
    const codes: SettingsCode[] = [
      "recipient_domain",
      "recipient_syntax",
      "too_many_recipients",
      "prefix_format",
      "retention_range",
      "date_order",
      "timezone_unknown",
      "hour_range",
      "malformed",
    ];
    for (const code of codes) {
      const key: CopyKey = issueCopy(code);
      expect(key).toBe(`set.err_${code}`);
      expect(copy[key].en.length).toBeGreaterThan(0);
    }
  });
});

describe("encodeSettingsState and decodeSettingsState", () => {
  const state = {
    values: settingsValues(form()),
    issues: [{ code: "date_order" as const, path: "closesAt" }],
  };

  it("hands a refused save's state to the page that asked for it", () => {
    const raw = encodeSettingsState("1791689526492", state);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSettingsState(raw, "1791689526492")).toEqual(state);
  });

  it("gives nothing for another save, a missing value or anything unreadable", () => {
    const raw = encodeSettingsState("1791689526492", state);
    expect(decodeSettingsState(raw, "1791689526000")).toBeNull();
    expect(decodeSettingsState(raw, undefined)).toBeNull();
    expect(decodeSettingsState(undefined, "1791689526492")).toBeNull();
    expect(decodeSettingsState("not-json", "1791689526492")).toBeNull();
    const tampered = Buffer.from(
      JSON.stringify({ at: "1", state: { issues: [{ code: "<b>", path: 1 }] } }),
    ).toString("base64url");
    expect(decodeSettingsState(tampered, "1")).toBeNull();
  });

  it("drops the submitted values rather than outgrow a cookie", () => {
    const long = { ...state, values: { ...state.values, recipients: "a".repeat(5000) } };
    const raw = encodeSettingsState("1", long);
    expect(raw.length).toBeLessThan(3500);
    expect(decodeSettingsState(raw, "1")).toEqual({ issues: state.issues });
  });

  it("keeps the first 20 issues so the cookie can never outgrow the browser limit", () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      code: "malformed" as const,
      path: `notificationRecipients.${String(index)}`,
    }));
    const raw = encodeSettingsState("1", { issues: many });
    expect(decodeSettingsState(raw, "1")?.issues).toEqual(many.slice(0, 20));
    expect(raw.length).toBeLessThan(3400);
  });
});

describe("TIMEZONES", () => {
  it("lists the runtime's zones, Panama and Madrid among them", () => {
    expect(TIMEZONES).toContain("America/Panama");
    expect(TIMEZONES).toContain("Europe/Madrid");
    expect(TIMEZONES).toContain("UTC");
  });
});

// ---------------------------------------------------------------------------

const ACTION = `/admin/forms/${FORM_ID}/settings`;

function render(props: Partial<SettingsFormProps> = {}): string {
  return renderToStaticMarkup(
    createElement(SettingsForm, {
      form: form(),
      csrfToken: "csrf-token-1",
      hasSubmissions: false,
      timezones: ["America/Panama", "Europe/Madrid"],
      action: ACTION,
      laterPhotosCovered: false,
      ...props,
    }),
  );
}

/** The opening tag of the element with `id`. */
function tagWithId(html: string, id: string): string {
  const match = new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`).exec(html);
  if (!match) throw new Error(`no element with id ${id}`);
  return match[0];
}

/** The opening tag of the control posting `name`, skipping hidden inputs. */
function control(html: string, name: string): string {
  const all = html.match(new RegExp(`<(input|select|textarea) [^>]*name="${name}"[^>]*>`, "g"));
  const visible = (all ?? []).filter((tag) => !tag.includes('type="hidden"'));
  if (visible.length === 0) throw new Error(`no control named ${name}`);
  return visible[0] ?? "";
}

/** The opening tag of the first `element` carrying every attribute in `attrs`. */
function tagWith(html: string, element: string, attrs: string[]): string {
  const tags = html.match(new RegExp(`<${element} [^>]*>`, "g")) ?? [];
  const found = tags.find((tag) => attrs.every((attr) => tag.includes(attr)));
  if (found === undefined) throw new Error(`no <${element}> with ${attrs.join(" ")}`);
  return found;
}

function describedBy(tag: string): string[] {
  return /aria-describedby="([^"]*)"/.exec(tag)?.[1]?.split(" ") ?? [];
}

describe("SettingsForm", () => {
  it("is the settings tab body: a section with its heading and the seven sections in order", () => {
    const html = render();
    expect(html).toMatch(/^<section [^>]*aria-labelledby="settings-title"/);
    expect(html).toMatch(/<h2 id="settings-title"[^>]*>Settings/);
    const headings = [...html.matchAll(/<h3[^>]*>([A-Za-z ]+)/g)].map((m) => m[1]);
    expect(headings).toEqual([
      "Notifications",
      "Data",
      "Availability",
      "Protection",
      "Responses",
      "Post plan",
      "Link",
    ]);
  });

  it("posts one form with the CSRF token and a Save button", () => {
    const html = render();
    expect(html.match(/<form /g)).toHaveLength(1);
    expect(tagWith(html, "form", [`action="${ACTION}"`, 'method="post"'])).toBeTruthy();
    expect(html).toContain('<input type="hidden" name="csrf" value="csrf-token-1"/>');
    expect(html).toMatch(/<button [^>]*type="submit"[^>]*>Save settings/);
  });

  it("shows the stored settings in their fields", () => {
    const html = render({
      form: form(
        {},
        {
          notificationCadence: "daily",
          digestHour: 7,
          opensAt: "2026-11-01T14:00:00.000Z",
          botChallenge: true,
        },
      ),
    });
    expect(html).toMatch(/<textarea [^>]*name="notificationRecipients"[^>]*>/);
    expect(html).toContain(">team@effluz.com\nops@effluz.com</textarea>");
    expect(control(html, "notificationCadence")).not.toContain("checked");
    expect(tagWith(html, "input", ['name="notificationCadence"', 'value="daily"'])).toContain(
      'checked=""',
    );
    expect(html).toContain('<option value="7" selected="">07:00</option>');
    expect(html.match(/<option value="\d+"/g)).toHaveLength(24);
    expect(html).toContain('<option value="America/Panama" selected="">America/Panama</option>');
    expect(control(html, "retentionMonths")).toMatch(/type="number" min="1" max="36"/);
    expect(control(html, "retentionMonths")).toContain('value="12"');
    expect(control(html, "opensAt")).toContain('type="datetime-local"');
    expect(control(html, "opensAt")).toContain('value="2026-11-01T09:00"');
    expect(html).toContain("2026-11-01 14:00 UTC");
    expect(control(html, "botChallenge")).toContain("checked");
    expect(control(html, "allowAnotherResponse")).not.toContain("checked");
    expect(control(html, "slug")).toContain('value="spring-stories"');
  });

  it("links every field to its help line", () => {
    const html = render();
    for (const [name, key] of [
      ["notificationRecipients", "set.recipients_hint"],
      ["retentionMonths", "set.retention_hint"],
      ["referencePrefix", "set.prefix_hint"],
      ["timezone", "set.timezone_hint"],
      ["botChallenge", "set.challenge_hint"],
      ["slug", "new.slug_hint"],
    ] as const) {
      const ids = describedBy(control(html, name));
      expect(ids.length, name).toBeGreaterThan(0);
      const texts = ids.map((id) => {
        const start = html.indexOf(tagWithId(html, id));
        return html.slice(start, html.indexOf("</p>", start));
      });
      expect(texts.join(" "), name).toContain(copy[key].en);
    }
  });

  it("tells staff the bot challenge is not available yet, next to the setting", () => {
    const html = render();
    const ids = describedBy(control(html, "botChallenge"));
    const texts = ids.map((id) => {
      const start = html.indexOf(tagWithId(html, id));
      return html.slice(start, html.indexOf("</p>", start));
    });
    expect(texts.join(" ")).toContain(copy["set.challenge_hint"].en);
    expect(texts.join(" ")).toContain(copy["set.challenge_unavailable"].en);
  });

  it("disables the prefix after the first submission and still posts its value", () => {
    expect(control(render(), "referencePrefix")).not.toContain("disabled");
    const html = render({ hasSubmissions: true });
    expect(control(html, "referencePrefix")).toContain('disabled=""');
    expect(html).toContain('<input type="hidden" name="referencePrefix" value="SS"/>');
  });

  it("disables the slug once the form was published", () => {
    expect(control(render(), "slug")).not.toContain("disabled");
    const html = render({
      form: form({ status: "published", currentVersionId: FORM_ID, currentVersionNumber: 1 }),
    });
    expect(control(html, "slug")).toContain('disabled=""');
  });

  it("shows the submitted values instead of the stored ones", () => {
    const html = render({
      values: { ...settingsValues(form()), retentionMonths: "40", slug: "new-name" },
    });
    expect(control(html, "retentionMonths")).toContain('value="40"');
    expect(control(html, "slug")).toContain('value="new-name"');
  });

  it("puts each issue next to its field, marks the field invalid and links the message", () => {
    const values = {
      ...settingsValues(form()),
      recipients: "team@effluz.com\nsomeone@example.com",
      closesAt: "2026-10-01T09:00",
      opensAt: "2026-11-01T09:00",
    };
    const html = render({
      values,
      issues: [
        { code: "recipient_domain", path: "notificationRecipients.1", params: { index: 1 } },
        { code: "date_order", path: "closesAt" },
      ],
    });
    const recipients = control(html, "notificationRecipients");
    expect(recipients).toContain('aria-invalid="true"');
    const errorId = describedBy(recipients)[0] ?? "";
    expect(tagWithId(html, errorId)).toMatch(/^<p [^>]*role="alert"/);
    expect(html).toContain("someone@example.com is not on an allowed domain.");
    // The message follows the text area, before the next field.
    expect(html.indexOf(errorId)).toBeGreaterThan(html.indexOf('name="notificationRecipients"'));
    expect(html.indexOf("is not on an allowed domain")).toBeLessThan(
      html.indexOf('name="notificationCadence"'),
    );

    const closes = control(html, "closesAt");
    expect(closes).toContain('aria-invalid="true"');
    expect(tagWithId(html, describedBy(closes)[0] ?? "")).toContain('role="alert"');
    expect(html).toContain(copy["set.err_date_order"].en);
    expect(control(html, "opensAt")).not.toContain("aria-invalid");
  });

  it("fills the limits into the range message", () => {
    const html = render({
      issues: [{ code: "retention_range", path: "retentionMonths", params: { min: 1, max: 36 } }],
    });
    expect(control(html, "retentionMonths")).toContain('aria-invalid="true"');
    expect(html).toContain("Enter a whole number from 1 to 36.");
  });

  it("shows a refusal of the slug or prefix on that field", () => {
    const html = render({ error: "slug_taken" });
    expect(control(html, "slug")).toContain('aria-invalid="true"');
    expect(html).toContain(copy["set.err_slug_taken"].en);
    const prefix = render({ error: "prefix_locked" });
    expect(control(prefix, "referencePrefix")).toContain('aria-invalid="true"');
    expect(prefix).toContain(copy["set.err_prefix_locked"].en);
  });

  it("states a malformed value with no field of its own, and an out-of-date page, above the sections", () => {
    const html = render({ issues: [{ code: "malformed", path: "" }] });
    expect(html).toMatch(/<div role="alert"[^>]*>.*This value could not be read/);
    expect(html.indexOf("This value could not be read")).toBeLessThan(html.indexOf("<h3"));
    const cadence = render({ issues: [{ code: "malformed", path: "notificationCadence" }] });
    expect(cadence.indexOf("This value could not be read")).toBeGreaterThan(
      cadence.indexOf('name="notificationCadence"'),
    );
    expect(cadence).not.toMatch(/<div role="alert"/);
    const stale = render({ error: "stale" });
    expect(stale).toMatch(/<div role="alert"[^>]*>.*This page was out of date/);
  });

  it("warns how many submissions a shorter retention deletes, with a button that confirms", () => {
    const html = render({ retentionConfirm: { count: 4, months: 6 } });
    expect(html).toMatch(/<div role="status"[^>]*>/);
    expect(html).toContain("Shortening to 6 months will delete 4 submissions on the next run.");
    const confirm = tagWith(html, "button", ['name="confirmRetentionPurge"']);
    expect(confirm).toContain('type="submit"');
    expect(confirm).toContain('value="1"');
    expect(html.slice(html.indexOf(confirm) + confirm.length)).toMatch(/^Delete them and save/);
    expect(describedBy(control(html, "retentionMonths"))).toContain("settings-retention-warn");
    expect(render()).not.toContain("confirmRetentionPurge");
  });

  it("never lets Enter confirm a purge: the first submit button is the ordinary Save", () => {
    const html = render({ retentionConfirm: { count: 4, months: 6 } });
    const firstSubmit = html.match(/<button [^>]*type="submit"[^>]*>/)?.[0] ?? "";
    expect(firstSubmit).not.toContain("confirmRetentionPurge");
    expect(html.slice(html.indexOf(firstSubmit) + firstSubmit.length)).toMatch(/^Save settings/);
    expect(html.indexOf(firstSubmit)).toBeLessThan(html.indexOf('name="confirmRetentionPurge"'));
  });

  it("describes the confirm button by the warning text", () => {
    const html = render({ retentionConfirm: { count: 4, months: 6 } });
    const confirm = tagWith(html, "button", ['name="confirmRetentionPurge"']);
    const warningId = describedBy(confirm)[0] ?? "";
    expect(warningId).toBe("settings-retention-warn");
    const warning = new RegExp(`<p [^>]*id="${warningId}"[^>]*>(.*?)</p>`).exec(html)?.[1] ?? "";
    expect(warning).toContain("Shortening to 6 months will delete 4 submissions");
  });

  it("marks every cadence radio invalid when the cadence has an issue", () => {
    const html = render({ issues: [{ code: "malformed", path: "notificationCadence" }] });
    for (const value of ["per_submission", "daily"]) {
      const radio = tagWith(html, "input", ['name="notificationCadence"', `value="${value}"`]);
      expect(radio).toContain('aria-invalid="true"');
    }
    const clean = render();
    expect(tagWith(clean, "input", ['name="notificationCadence"', 'value="daily"'])).not.toContain(
      "aria-invalid",
    );
  });

  it("confirms a save with a success banner", () => {
    const html = render({ saved: true });
    expect(html).toMatch(/<div role="status"[^>]*><div>Settings saved/);
    expect(render()).not.toContain("Settings saved");
  });

  it("warns that no one is notified when the list is empty", () => {
    const html = render({ form: form({}, { notificationRecipients: [] }) });
    expect(html).toContain(copy["set.no_recipients"].en);
    expect(render()).not.toContain(copy["set.no_recipients"].en);
  });

  it("says nothing was saved beside Save after a refused save", () => {
    expect(render()).not.toContain(copy["set.discard_warn"].en);
    expect(render({ error: "slug_taken" })).toMatch(
      /<p role="status"[^>]*>You have unsaved changes\./,
    );
  });

  it("offers the form's zone even when the list lacks it", () => {
    const html = render({ form: form({}, { timezone: "UTC" }) });
    expect(html).toContain('<option value="UTC" selected="">UTC</option>');
  });

  it("leaves the method to React when the action is a function", () => {
    const html = render({ action: () => undefined });
    expect(html).not.toContain('method="post"');
  });
});
