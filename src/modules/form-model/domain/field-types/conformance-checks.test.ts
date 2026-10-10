import { describe, expect, it } from "vitest";
import { defineFieldType } from "../field-type";
import type { PublishCode } from "../issues";
import { checkbox } from "./checkbox";
import { conformanceChecks } from "./conformance-checks";
import { consent } from "./consent";
import { fileUpload } from "./file-upload";
import { multipleChoice } from "./multiple-choice";
import { shortText } from "./short-text";

const failing = (def: Parameters<typeof conformanceChecks>[0]) =>
  conformanceChecks(def)
    .filter((c) => !c.ok)
    .map((c) => c.name);

describe("conformanceChecks", () => {
  it("passes a conforming type", () => {
    expect(failing(checkbox)).toEqual([]);
  });
  it("fails the export check when cells and headers disagree", () => {
    const broken = defineFieldType({
      ...checkbox,
      exportHeaders: (label) => [label, `${label} (note)`],
    });
    expect(failing(broken)).toEqual(["exports one cell per header"]);
  });
  it("fails the limit check when an over-limit outcome has no numeric n", () => {
    const broken = defineFieldType({
      ...checkbox,
      validate: (a) => (a ? [] : ["max_length"]),
      fixtures: { ...checkbox.fixtures, overLimitAnswers: [false] },
    });
    expect(failing(broken)).toEqual(["reports limits with a numeric n"]);
  });
  it("passes a type that declares every hook", () => {
    expect(failing(consent)).toEqual([]);
  });
  it("fails the always-required check without a requiredCode", () => {
    const broken = defineFieldType({ ...checkbox, alwaysRequired: true });
    expect(failing(broken)).toEqual([
      "alwaysRequired types declare a requiredCode and never report empty",
    ]);
  });
  it("judges always-required emptiness on the normalized answer", () => {
    const broken = defineFieldType({
      ...consent,
      normalize: (a) => ({ ...a, textVersion: "0000000000000000" }),
      validate: () => [],
      isEmpty: (a) => a.textVersion === "0000000000000000",
      consentRecord: () => ({ textVersion: "0123456789abcdef" }),
    });
    expect(failing(broken)).toEqual([
      "alwaysRequired types declare a requiredCode and never report empty",
    ]);
  });
  it("fails the publish hooks check for a malformed settings text or role", () => {
    const blankPath = defineFieldType({
      ...checkbox,
      localizedSettingsTexts: () => [{ path: "", text: undefined, blankCode: null }],
    });
    expect(failing(blankPath)).toEqual(["publish hooks return well-formed results"]);
    const unknownCode = defineFieldType({
      ...checkbox,
      exclusiveRoles: () => [{ role: "x", code: "nope" as PublishCode }],
    });
    expect(failing(unknownCode)).toEqual(["publish hooks return well-formed results"]);
  });
  it("fails the publish hooks check for a draft on a clean field", () => {
    const empty = defineFieldType({
      ...checkbox,
      publishChecks: () => [{ code: "no_input", path: "" }],
    });
    expect(failing(empty)).toEqual(["publish hooks return well-formed results"]);
    const wellFormed = defineFieldType({
      ...checkbox,
      publishChecks: () => [{ code: "no_input", path: "validation" }],
    });
    expect(failing(wellFormed)).toEqual(["publish hooks return well-formed results"]);
  });
  it("fails the publish hooks check for a malformed draft on an extreme rule value", () => {
    const broken = defineFieldType({
      ...shortText,
      publishChecks: (field) =>
        field.validation.length > 0 ? [{ code: "over_maximum", path: "" }] : [],
    });
    expect(failing(broken)).toEqual(["publish hooks return well-formed results"]);
    const unknownCode = defineFieldType({
      ...shortText,
      publishChecks: (field) =>
        field.validation.length > 0 ? [{ code: "nope" as PublishCode, path: "validation" }] : [],
    });
    expect(failing(unknownCode)).toEqual(["publish hooks return well-formed results"]);
  });
  it("passes a type whose publish check reports an extreme rule value well", () => {
    expect(failing(fileUpload)).toEqual([]);
    expect(failing(multipleChoice)).toEqual([]);
  });
  it("fails the consent record check when the text version is not 16 hex digits", () => {
    const broken = defineFieldType({ ...consent, consentRecord: () => ({ textVersion: "v1" }) });
    expect(failing(broken)).toEqual(["consentRecord returns a text version"]);
  });
  it("reports a check that throws as failed instead of throwing", () => {
    const broken = defineFieldType({
      ...checkbox,
      isEmpty: () => {
        throw new Error("boom");
      },
    });
    const check = conformanceChecks(broken).find((c) => c.name === "classifies empty answers");
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("boom");
  });
});
