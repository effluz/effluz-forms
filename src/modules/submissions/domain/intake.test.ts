import { describe, expect, it } from "vitest";
import { asKey } from "@/shared/domain/form-model";
import { todayIn } from "./dates";
import {
  firstLanguage,
  firstPageWithIssue,
  planFiles,
  submitterAddress,
  uploadFields,
} from "./intake";
import { registry, storyVersion } from "./testing/versions";

const upload = (id: string) => ({
  id,
  stagingRef: `in-progress/r/${id}.jpg`,
  kind: "image" as const,
  contentType: "image/jpeg",
  size: 1,
});

describe("intake planning", () => {
  it("attaches files the final answers name, in answer order, and discards the rest", () => {
    const plan = planFiles(
      { f_photos: ["b", "a"] },
      { f_photos: [upload("a"), upload("b"), upload("c")], f_hidden: [upload("d")] },
    );
    expect(plan.attached.map((p) => [p.fieldKey, p.position, p.upload.id])).toEqual([
      ["f_photos", 1, "b"],
      ["f_photos", 2, "a"],
    ]);
    expect(plan.discarded.map((u) => u.id).sort()).toEqual(["c", "d"]);
  });

  it("finds upload fields, the submitter's address and the first page with an issue", () => {
    const v = storyVersion();
    expect(uploadFields(v, registry).map((u) => [u.field.key, u.limits.maxFiles])).toEqual([
      ["f_photos", 3],
    ]);
    expect(submitterAddress(v, registry, { f_email: "family@example.com" })).toBe(
      "family@example.com",
    );
    expect(submitterAddress(v, registry, {})).toBeNull();
    expect(submitterAddress(v, registry, { f_email: "" })).toBeNull();
    expect(
      firstPageWithIssue(v, [
        { code: "consent", field: asKey("f_consent") },
        { code: "required", field: asKey("f_photos") },
      ]),
    ).toBe("page_baby");
    expect(firstPageWithIssue(v, [])).toBeNull();
    expect(firstLanguage("bilingual")).toBe("en");
    expect(firstLanguage("en")).toBe("en");
    expect(firstLanguage("es")).toBe("es");
  });

  it("gives today's date in the form's time zone", () => {
    expect(todayIn("America/Panama", new Date("2026-10-11T03:00:00Z"))).toBe("2026-10-10");
    expect(todayIn("UTC", new Date("2026-10-11T03:00:00Z"))).toBe("2026-10-11");
  });
});
