import { describe, expect, it } from "vitest";
import {
  buildDefaultRegistry,
  checkDefinition,
  evaluateVisibility,
  exportColumns,
  exportRow,
  parseDraft,
  parseVersion,
  validateForPublish,
  validateSubmission,
} from "@/shared/domain/form-model";
import { referenceFormDraft, referenceSubmission } from "./reference-form";

const registry = buildDefaultRegistry();

describe("reference form through the public API", () => {
  it("parses as a draft and as a strict version", () => {
    expect(parseDraft(referenceFormDraft, registry).ok).toBe(true);
    expect(parseVersion(referenceFormDraft, registry).ok).toBe(true);
  });
  it("publishes with retention 12 and fails without", () => {
    const r = parseDraft(referenceFormDraft, registry);
    if (!r.ok) throw new Error("parse");
    expect(validateForPublish(r.version, registry, { retentionMonths: 12 })).toEqual([]);
    expect(validateForPublish(r.version, registry, {}).map((i) => i.code)).toEqual([
      "retention_missing",
    ]);
  });
  it("has 5 pages, 18 inputs and at most 7 inputs per page", () => {
    const r = parseDraft(referenceFormDraft, registry);
    if (!r.ok) throw new Error("parse");
    expect(r.version.pages).toHaveLength(5);
    const counts = r.version.pages.map((p) => p.fields.filter((f) => f.type !== "section").length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(18);
    expect(Math.max(...counts)).toBeLessThanOrEqual(7);
  });
  it("requires consent because it collects personal data", () => {
    const withoutConsent = structuredClone(referenceFormDraft) as {
      pages: { fields: { type: string }[] }[];
    };
    const lastPage = withoutConsent.pages[4];
    if (!lastPage) throw new Error("fixture has no fifth page");
    lastPage.fields = lastPage.fields.filter((f) => f.type !== "consent");
    const r = parseDraft(withoutConsent, registry);
    if (!r.ok) throw new Error("parse");
    expect(checkDefinition(r.version, registry).map((i) => i.code)).toContain("consent_missing");
  });
  it("accepts the synthetic submission and rejects one without photos", () => {
    const r = parseDraft(referenceFormDraft, registry);
    if (!r.ok) throw new Error("parse");
    const ok = validateSubmission(r.version, registry, referenceSubmission, {
      today: "2026-10-10",
    });
    expect(ok.ok).toBe(true);
    const noPhotos = validateSubmission(
      r.version,
      registry,
      { ...referenceSubmission, photos: [] },
      { today: "2026-10-10" },
    );
    expect(noPhotos.ok).toBe(false);
    if (!noPhotos.ok) expect(noPhotos.issues).toContainEqual({ code: "required", field: "photos" });
  });
  it("everything is visible (no logic) and exports 18 keys to 20 columns", () => {
    const r = parseDraft(referenceFormDraft, registry);
    if (!r.ok) throw new Error("parse");
    const vis = evaluateVisibility(r.version, referenceSubmission);
    expect([...vis.fields.values()].every(Boolean)).toBe(true);
    const cols = exportColumns([r.version], registry, "es");
    expect(cols).toHaveLength(20); // 16 single-cell + photos (2) + consent (2)
    const ok = validateSubmission(r.version, registry, referenceSubmission, {
      today: "2026-10-10",
    });
    if (!ok.ok) throw new Error("submission");
    expect(exportRow(cols, r.version, registry, ok.answers, "es")).toHaveLength(20);
  });
  it("keeps the restricted rich text as markdown in description and help", () => {
    const r = parseDraft(referenceFormDraft, registry);
    if (!r.ok) throw new Error("parse");
    const [first, , , fourth] = r.version.pages;
    expect(first?.description?.es).toContain("](https://");
    const story = fourth?.fields.find((f) => f.key === "story");
    expect(story?.help?.es).toContain("\n- ");
  });
});
