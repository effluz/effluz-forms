import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorSummary } from "./ErrorSummary";
import { RefusedFilesContext } from "./refused-files";
import { summaryEntries, summaryHeading } from "./summary";

describe("summaryEntries", () => {
  it("replaces a field's stored entry with its refused files, in field order", () => {
    const items = [
      { fieldKey: "f_name", href: "#f-f_name", message: "Name is required" },
      { fieldKey: "f_photos", href: "#f-f_photos", message: "Photos is required" },
    ];
    const refused = [
      { fieldKey: "f_photos", message: "a.txt is not a supported type." },
      { fieldKey: "f_photos", message: "b.jpg is larger than 10 MB" },
    ];
    expect(summaryEntries(items, refused)).toEqual([
      { href: "#f-f_name", message: "Name is required" },
      { href: "#f-f_photos", message: "a.txt is not a supported type." },
      { href: "#f-f_photos", message: "b.jpg is larger than 10 MB" },
    ]);
  });

  it("gives a field with only refused files its messages at the end", () => {
    expect(summaryEntries([], [{ fieldKey: "f_photos", message: "x" }])).toEqual([
      { href: "#f-f_photos", message: "x" },
    ]);
  });
});

describe("summaryHeading", () => {
  it("picks the heading by the language's plural rule", () => {
    const headings = {
      one: "Corrige 1 problema para continuar",
      other: "Corrige {count} problemas para continuar",
    };
    expect(summaryHeading(1, "es", headings)).toBe("Corrige 1 problema para continuar");
    expect(summaryHeading(3, "es", headings)).toBe("Corrige 3 problemas para continuar");
  });
});

describe("ErrorSummary", () => {
  const headings = {
    one: "Please fix 1 problem before continuing",
    other: "Please fix {count} problems before continuing",
  };

  it("lists a refused post's files, counted in the heading, linked to the field", () => {
    const html = renderToStaticMarkup(
      createElement(
        RefusedFilesContext.Provider,
        { value: [{ fieldKey: "f_photos", message: "notes.txt is not a supported type." }] },
        createElement(ErrorSummary, { items: [], locale: "en", headings }),
      ),
    );
    expect(html).toMatch(/<div[^>]*role="alert"[^>]*data-error-summary/);
    expect(html).toContain("Please fix 1 problem before continuing");
    expect(html).toContain('<a href="#f-f_photos">notes.txt is not a supported type.</a>');
  });

  it("renders nothing when there is nothing to fix", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorSummary, { items: [], locale: "en", headings }),
    );
    expect(html).toBe("");
  });
});
