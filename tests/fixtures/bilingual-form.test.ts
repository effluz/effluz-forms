import { describe, expect, it } from "vitest";
import {
  buildDefaultRegistry,
  collectsPersonalData,
  parseDraft,
  parseVersion,
  validateForPublish,
} from "@/shared/domain/form-model";
import { bilingualFormDraft } from "./bilingual-form";

const registry = buildDefaultRegistry();

describe("bilingual form through the public API", () => {
  it("parses as a draft and as a strict version", () => {
    expect(parseDraft(bilingualFormDraft, registry).ok).toBe(true);
    expect(parseVersion(bilingualFormDraft, registry).ok).toBe(true);
  });
  it("collects no personal data and publishes with retention alone", () => {
    const r = parseDraft(bilingualFormDraft, registry);
    if (!r.ok) throw new Error("parse");
    expect(collectsPersonalData(r.version, registry)).toBe(false);
    expect(validateForPublish(r.version, registry, { retentionMonths: 12 })).toEqual([]);
  });
});
