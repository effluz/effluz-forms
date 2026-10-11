import { describe, expect, it } from "vitest";
import { asKey } from "../keys";
import { checkbox } from "./checkbox";
import { optionsSchema } from "./choice-shared";
import { multipleChoice } from "./multiple-choice";
import { effectiveDisplay, singleChoice } from "./single-choice";

const options = [
  { key: asKey("single"), label: { en: "One baby", es: "Un solo bebé" } },
  { key: asKey("twins"), label: { en: "Twins", es: "Gemelar" } },
];
const labelTexts = [
  { path: "options/0/label", text: options[0]?.label, blankCode: "option_unlabeled" },
  { path: "options/1/label", text: options[1]?.label, blankCode: "option_unlabeled" },
];

describe("options", () => {
  it("requires unique keys and at most 50", () => {
    expect(optionsSchema.safeParse([options[0], options[0]]).success).toBe(false);
    expect(
      optionsSchema.safeParse(
        Array.from({ length: 51 }, (_, i) => ({ key: `opt${String(i)}`, label: { en: "x" } })),
      ).success,
    ).toBe(false);
    expect(optionsSchema.safeParse([]).success).toBe(false);
  });
});

describe("single_choice", () => {
  const s = { options, display: "radio" as const };
  it("reports an answer that is not an option key as unknown_option", () => {
    expect(singleChoice.validate(asKey("triplets"), s)).toEqual(["unknown_option"]);
    expect(singleChoice.validate(asKey("twins"), s)).toEqual([]);
  });
  it("falls back to radio with six or fewer options", () => {
    expect(effectiveDisplay({ options, display: "dropdown" })).toBe("radio");
    const seven = Array.from({ length: 7 }, (_, i) => ({
      key: asKey(`opt_${String(i)}`),
      label: { en: "x" },
    }));
    expect(effectiveDisplay({ options: seven, display: "dropdown" })).toBe("dropdown");
  });
  it("exports the label in the requested locale", () => {
    expect(singleChoice.exportCells(asKey("twins"), s, "es", "bilingual")).toEqual(["Gemelar"]);
    expect(singleChoice.exportCells(undefined, s, "es", "bilingual")).toEqual([""]);
  });
  it("asks publish to check every option label and has no other publish checks", () => {
    expect(singleChoice.localizedSettingsTexts?.(s)).toEqual(labelTexts);
    expect(singleChoice.publishChecks?.({ required: false, validation: [] }, s)).toEqual([]);
  });
});

describe("multiple_choice", () => {
  const s = { options };
  it("normalizes to unique keys in option order", () => {
    expect(multipleChoice.normalize([asKey("twins"), asKey("single"), asKey("twins")], s)).toEqual([
      "single",
      "twins",
    ]);
  });
  it("keeps unknown keys after known ones so validation reports them", () => {
    expect(
      multipleChoice.normalize([asKey("twins"), asKey("nope"), asKey("single"), asKey("twins")], s),
    ).toEqual(["single", "twins", "nope"]);
    expect(
      multipleChoice.validate(multipleChoice.normalize([asKey("single"), asKey("nope")], s), s),
    ).toEqual(["unknown_option"]);
  });
  it("flags unknown keys and exports joined labels", () => {
    expect(multipleChoice.validate([asKey("single"), asKey("nope")], s)).toEqual([
      "unknown_option",
    ]);
    expect(
      multipleChoice.exportCells([asKey("single"), asKey("twins")], s, "en", "bilingual"),
    ).toEqual(["One baby; Twins"]);
  });
  it("empty array is empty", () => {
    expect(multipleChoice.isEmpty([])).toBe(true);
  });
  it("asks publish to check every option label", () => {
    expect(multipleChoice.localizedSettingsTexts?.(s)).toEqual(labelTexts);
  });
  it("reports a selection count beyond the option count at validation", () => {
    const field = (validation: { rule: "min_selected" | "max_selected"; value: number }[]) => ({
      required: false,
      validation,
    });
    expect(multipleChoice.publishChecks?.(field([{ rule: "min_selected", value: 3 }]), s)).toEqual([
      {
        code: "over_maximum",
        path: "validation",
        params: { detail: "min_selected 3 > 2 options" },
      },
    ]);
    expect(multipleChoice.publishChecks?.(field([{ rule: "max_selected", value: 4 }]), s)).toEqual([
      {
        code: "over_maximum",
        path: "validation",
        params: { detail: "max_selected 4 > 2 options" },
      },
    ]);
    expect(multipleChoice.publishChecks?.(field([{ rule: "max_selected", value: 2 }]), s)).toEqual(
      [],
    );
  });
});

describe("checkbox", () => {
  it("false is empty for required purposes and exports yes/no words", () => {
    expect(checkbox.isEmpty(false)).toBe(true);
    expect(checkbox.exportCells(true, {}, "es", "bilingual")).toEqual(["sí"]);
    expect(checkbox.exportCells(false, {}, "en", "bilingual")).toEqual(["no"]);
  });
});

describe("default settings", () => {
  function counter() {
    let n = 0;
    return {
      newId: () => {
        n += 1;
        return `ABCD${n.toString(16).padStart(4, "0")}-0000-4000-8000-000000000000`;
      },
    };
  }
  it.each([singleChoice, multipleChoice].map((d) => [d.id, d] as const))(
    "%s parses its defaults: two options with generated keys and empty labels",
    (_id, def) => {
      const defaults = def.defaultSettings(counter());
      expect(def.settingsSchema.safeParse(defaults).success).toBe(true);
      expect(defaults.options).toEqual([
        { key: "o_abcd0001", label: {} },
        { key: "o_abcd0002", label: {} },
      ]);
    },
  );
  it("single_choice starts as radio buttons", () => {
    expect(singleChoice.defaultSettings(counter()).display).toBe("radio");
  });
  it("checkbox parses its own defaults", () => {
    expect(checkbox.settingsSchema.safeParse(checkbox.defaultSettings(counter())).success).toBe(
      true,
    );
  });
});
