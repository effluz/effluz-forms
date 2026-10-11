import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, checkSlug, slugFromTitle } from "./slug";

describe("checkSlug", () => {
  it("accepts a three letter slug", () => {
    expect(checkSlug("abc")).toBeNull();
  });

  it("accepts letters, digits and inner hyphens", () => {
    expect(checkSlug("historias-2026")).toBeNull();
  });

  it("accepts exactly 64 characters", () => {
    expect(checkSlug("a".repeat(64))).toBeNull();
  });

  it("rejects two characters", () => {
    expect(checkSlug("ab")).toBe("slug_format");
  });

  it("rejects one character", () => {
    expect(checkSlug("a")).toBe("slug_format");
  });

  it("rejects a leading hyphen", () => {
    expect(checkSlug("-abc")).toBe("slug_format");
  });

  it("rejects a trailing hyphen", () => {
    expect(checkSlug("abc-")).toBe("slug_format");
  });

  it("rejects uppercase letters", () => {
    expect(checkSlug("Abc")).toBe("slug_format");
  });

  it("rejects underscores", () => {
    expect(checkSlug("a_b")).toBe("slug_format");
  });

  it("rejects 65 characters", () => {
    expect(checkSlug("a".repeat(65))).toBe("slug_format");
  });

  it.each(RESERVED_SLUGS)("reports %s as reserved", (word) => {
    expect(checkSlug(word)).toBe("slug_reserved");
  });

  it("does not treat a longer slug starting with a reserved word as reserved", () => {
    expect(checkSlug("admin-news")).toBeNull();
  });
});

describe("slugFromTitle", () => {
  it("lowercases, strips accents and joins words with hyphens", () => {
    expect(slugFromTitle({ es: "Historia de bebé prematuro" }, "es")).toBe(
      "historia-de-bebe-prematuro",
    );
  });

  it("uses English before Spanish for a bilingual form", () => {
    expect(slugFromTitle({ en: "Preemie stories", es: "Historias" }, "bilingual")).toBe(
      "preemie-stories",
    );
  });

  it("collapses runs of punctuation and trims hyphens", () => {
    expect(slugFromTitle({ en: "  --Hello,   World!!  " }, "en")).toBe("hello-world");
  });

  it("cuts to 64 characters without a trailing hyphen", () => {
    const slug = slugFromTitle({ en: `${"a".repeat(63)} bbbb` }, "en");
    expect(slug).toBe("a".repeat(63));
    expect(checkSlug(slug)).toBeNull();
  });

  it("appends -form to a result shorter than three characters", () => {
    expect(slugFromTitle({ en: "Hi" }, "en")).toBe("hi-form");
  });

  it("appends -form to a reserved word", () => {
    expect(slugFromTitle({ en: "Admin" }, "en")).toBe("admin-form");
  });

  it("falls back to form when no letters or digits remain", () => {
    expect(slugFromTitle({ en: "!!!" }, "en")).toBe("form");
  });

  it("falls back to form when the title is missing", () => {
    expect(slugFromTitle({}, "bilingual")).toBe("form");
  });
});
