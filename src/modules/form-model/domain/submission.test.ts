import { describe, expect, it } from "vitest";
import { consentTextVersion } from "./consent-text";
import { buildDefaultRegistry } from "./field-types";
import { isAbsent, validateSubmission } from "./submission";
import { parseDraft } from "./version";

const registry = buildDefaultRegistry();
const consentText = { es: "Soy mayor de edad y acepto." };
const r = parseDraft(
  {
    languages: "es",
    confirmation: { screen: { es: "Gracias" } },
    pages: [
      {
        key: "page1",
        title: { es: "Datos" },
        fields: [
          {
            key: "name",
            type: "short_text",
            label: { es: "Nombre" },
            required: true,
            validation: [{ rule: "min_length", value: 2 }],
          },
          { key: "mail", type: "email", label: { es: "Correo" }, required: true },
          {
            key: "weeks",
            type: "number",
            label: { es: "Semanas" },
            settings: { integerOnly: true },
            validation: [{ rule: "max_value", value: 42 }],
          },
          { key: "twins", type: "checkbox", label: { es: "Gemelos" } },
          {
            key: "names",
            type: "short_text",
            label: { es: "Nombres" },
            required: true,
            visibility: { field: "twins", op: "equals", value: true },
          },
          {
            key: "born",
            type: "date",
            label: { es: "Nacimiento" },
            validation: [{ rule: "not_future" }],
          },
          {
            key: "born2",
            type: "date",
            label: { es: "Otra fecha" },
            validation: [{ rule: "min_date", value: "2027-01-01" }],
          },
          {
            key: "optin",
            type: "checkbox",
            label: { es: "Acepto" },
            validation: [{ rule: "must_be_true" }],
          },
          { key: "info", type: "section", label: {}, settings: { title: { es: "Info" } } },
          {
            key: "agree",
            type: "consent",
            label: { es: "Consentimiento" },
            settings: { text: consentText },
          },
        ],
      },
    ],
  },
  registry,
);
if (!r.ok) throw new Error(JSON.stringify(r.issues));
const version = r.version;
const ctx = { today: "2026-10-10" };
const accepted = { accepted: true, textVersion: consentTextVersion(consentText) };

const rb = parseDraft(
  {
    languages: "es",
    confirmation: { screen: { es: "Gracias" } },
    pages: [
      {
        key: "page1",
        title: { es: "Datos" },
        fields: [{ key: "reqbox", type: "checkbox", label: { es: "Casilla" }, required: true }],
      },
    ],
  },
  registry,
);
if (!rb.ok) throw new Error(JSON.stringify(rb.issues));

describe("isAbsent", () => {
  it("treats undefined, null, blank and empty array as absent, but not 0 or false", () => {
    for (const a of [undefined, null, "", "  ", []]) expect(isAbsent(a)).toBe(true);
    for (const p of [0, false, "x", [1]]) expect(isAbsent(p)).toBe(false);
  });
});

describe("validateSubmission", () => {
  it("accepts a complete submission, normalizes, drops extra keys and reports consent", () => {
    const res = validateSubmission(
      version,
      registry,
      {
        name: "  Ana ",
        mail: "ANA@Example.com",
        weeks: 30,
        twins: false,
        names: "ignored",
        born: "2026-01-01",
        agree: accepted,
        extra: "x",
      },
      ctx,
    );
    expect(res).toEqual({
      ok: true,
      answers: {
        name: "Ana",
        mail: "ana@example.com",
        weeks: 30,
        twins: false,
        born: "2026-01-01",
        agree: accepted,
      },
      consent: { fieldKey: "agree", textVersion: accepted.textVersion },
    });
  });
  it("reports required and consent for absent answers", () => {
    const res = validateSubmission(version, registry, {}, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.issues).toEqual(
        expect.arrayContaining([
          { code: "required", field: "name" },
          { code: "required", field: "mail" },
          { code: "consent", field: "agree" },
        ]),
      );
  });
  it("requires names only when twins is true", () => {
    const res = validateSubmission(
      version,
      registry,
      { name: "Ana", mail: "a@b.co", twins: true, agree: accepted },
      ctx,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues).toContainEqual({ code: "required", field: "names" });
  });
  it("reports shape, intrinsic and rule issues with params", () => {
    const res = validateSubmission(
      version,
      registry,
      { name: "A", mail: "nope", weeks: 50, born: "2027-01-01", agree: accepted },
      ctx,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues).toContainEqual({ code: "min_length", field: "name", params: { n: 2 } });
      expect(res.issues).toContainEqual({ code: "email_syntax", field: "mail" });
      expect(res.issues).toContainEqual({ code: "number_max", field: "weeks", params: { n: 42 } });
      expect(res.issues).toContainEqual({ code: "date_not_future", field: "born" });
    }
  });
  it("skips rules for a field whose intrinsic check failed", () => {
    const res = validateSubmission(
      version,
      registry,
      { name: "Ana", mail: "a@b.co", weeks: 50.5, agree: accepted },
      ctx,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const weeks = res.issues.filter((i) => i.field === "weeks");
      expect(weeks).toEqual([{ code: "integer", field: "weeks" }]);
    }
  });
  it("yields only date_invalid for an unreal date, never also date_min", () => {
    const res = validateSubmission(
      version,
      registry,
      { name: "Ana", mail: "a@b.co", born2: "2026-02-30", agree: accepted },
      ctx,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const issues = res.issues.filter((i) => i.field === "born2");
      expect(issues).toEqual([{ code: "date_invalid", field: "born2" }]);
    }
  });
  it("attaches the hard cap to an intrinsic max_length issue", () => {
    const res = validateSubmission(
      version,
      registry,
      { name: "a".repeat(5001), mail: "a@b.co", agree: accepted },
      ctx,
    );
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.issues).toContainEqual({
        code: "max_length",
        field: "name",
        params: { n: 5000 },
      });
  });
  it("reads only own properties of the raw answers", () => {
    const inherited = Object.create({ name: "Ana" }) as Record<string, unknown>;
    inherited["mail"] = "a@b.co";
    inherited["agree"] = accepted;
    const res = validateSubmission(version, registry, inherited, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues).toContainEqual({ code: "required", field: "name" });
  });
  it("runs rules on a present-but-empty answer of a non-required field", () => {
    const base = { name: "Ana", mail: "a@b.co", agree: accepted };
    const no = validateSubmission(version, registry, { ...base, optin: false }, ctx);
    expect(no.ok).toBe(false);
    if (!no.ok)
      expect(no.issues.filter((i) => i.field === "optin")).toEqual([
        { code: "must_be_true", field: "optin" },
      ]);
    const yes = validateSubmission(version, registry, { ...base, optin: true }, ctx);
    expect(yes.ok).toBe(true);
    if (yes.ok) expect(yes.answers["optin"]).toBe(true);
  });
  it("reports only required for a required checkbox answered false", () => {
    const res = validateSubmission(rb.version, registry, { reqbox: false }, ctx);
    expect(res).toEqual({ ok: false, issues: [{ code: "required", field: "reqbox" }] });
  });
  it("codes a declined or malformed consent answer as consent, not invalid_shape", () => {
    for (const agree of [{ accepted: false, textVersion: accepted.textVersion }, "yes"]) {
      const res = validateSubmission(
        version,
        registry,
        { name: "Ana", mail: "a@b.co", agree },
        ctx,
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.issues.filter((i) => i.field === "agree")).toEqual([
          { code: "consent", field: "agree" },
        ]);
      }
    }
  });
  it("treats a null body as empty instead of throwing", () => {
    const res = validateSubmission(
      version,
      registry,
      null as unknown as Record<string, unknown>,
      ctx,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues).toContainEqual({ code: "required", field: "name" });
  });
  it("reports invalid_shape for a wrong type instead of throwing", () => {
    const res = validateSubmission(
      version,
      registry,
      { name: 5, mail: "a@b.co", agree: accepted },
      ctx,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues).toContainEqual({ code: "invalid_shape", field: "name" });
  });
  it("rejects a stale consent text version", () => {
    const res = validateSubmission(
      version,
      registry,
      { name: "Ana", mail: "a@b.co", agree: { accepted: true, textVersion: "0123456789abcdef" } },
      ctx,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues).toContainEqual({ code: "consent", field: "agree" });
  });
});
