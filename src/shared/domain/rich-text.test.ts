import { describe, expect, it } from "vitest";
import { parseRichText, richTextToPlain } from "./rich-text";

const t = (text: string) => ({ kind: "text", text });

describe("parseRichText", () => {
  it("splits paragraphs on blank lines and keeps single newlines as breaks", () => {
    expect(parseRichText("One\ntwo\n\nThree")).toEqual([
      { kind: "paragraph", children: [t("One"), { kind: "break" }, t("two")] },
      { kind: "paragraph", children: [t("Three")] },
    ]);
  });

  it("reads bold, italic and https links, nested", () => {
    expect(parseRichText("**Bold _both_** and [site](https://example.com/a)")).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "bold", children: [t("Bold "), { kind: "italic", children: [t("both")] }] },
          t(" and "),
          { kind: "link", href: "https://example.com/a", children: [t("site")] },
        ],
      },
    ]);
  });

  it("groups bulleted and numbered lines into lists", () => {
    expect(parseRichText("- a\n- b\n1. c")).toEqual([
      { kind: "bullets", items: [[t("a")], [t("b")]] },
      { kind: "numbers", items: [[t("c")]] },
    ]);
  });

  it("leaves everything else literal: http and javascript links, html, snake_case, lone markers", () => {
    const source =
      "[x](http://example.com) [y](javascript:alert(1)) <b>z</b> snake_case_name **open";
    expect(parseRichText(source)).toEqual([{ kind: "paragraph", children: [t(source)] }]);
  });

  it("never nests a link inside a link", () => {
    const [block] = parseRichText("[a [b](https://example.com/b)](https://example.com/a)");
    expect(JSON.stringify(block)).not.toMatch(/"link".*"link"/);
  });

  it("keeps credentialed, uppercase-scheme and nested javascript links literal", () => {
    // A link with embedded credentials is read as literal text: the address would display one host
    // while the browser signs in with the other, so staff cannot publish it by accident.
    for (const source of [
      "[x](https://user:pw@example.com/)",
      "[x](HTTPS://example.com/)",
      "**[x](javascript:alert(1))**",
      "_[x](javascript:alert(1))_",
    ]) {
      expect(JSON.stringify(parseRichText(source))).not.toContain('"link"');
    }
    expect(parseRichText("**[x](javascript:alert(1))**")).toEqual([
      {
        kind: "paragraph",
        children: [{ kind: "bold", children: [t("[x](javascript:alert(1))")] }],
      },
    ]);
  });

  it("normalizes CRLF and drops leading and trailing blank lines", () => {
    expect(parseRichText("\r\n\r\nHi\r\n")).toEqual([{ kind: "paragraph", children: [t("Hi")] }]);
  });
});

describe("parseRichText on pathological input", () => {
  const BOUND_MS = 200;
  const REPEATS = 20_000;

  it.each([
    ["repeated italic openers with letters after", "(_a".repeat(REPEATS)],
    ["repeated link openers", "[".repeat(REPEATS)],
    ["repeated link openers and one closer", `${"[".repeat(REPEATS)}]`],
  ])("stays linear and literal on %s", (_name, source) => {
    const started = performance.now();
    const blocks = parseRichText(source);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(BOUND_MS);
    expect(blocks).toEqual([{ kind: "paragraph", children: [t(source)] }]);
  });

  it("starts a link at the innermost bracket instead of reading past the next opener", () => {
    expect(parseRichText("[a [b](https://example.com/b)](https://example.com/a)")).toEqual([
      {
        kind: "paragraph",
        children: [
          t("[a "),
          { kind: "link", href: "https://example.com/b", children: [t("b")] },
          t("](https://example.com/a)"),
        ],
      },
    ]);
  });

  it("still reads italics when earlier openers did find a closer", () => {
    expect(parseRichText("(_a_ and (_b_)")).toEqual([
      {
        kind: "paragraph",
        children: [
          t("("),
          { kind: "italic", children: [t("a")] },
          t(" and ("),
          { kind: "italic", children: [t("b")] },
          t(")"),
        ],
      },
    ]);
  });
});

describe("richTextToPlain", () => {
  it("writes lists with markers and links with their address", () => {
    expect(
      richTextToPlain(parseRichText("Hi **there**\n\n- one\n1. [two](https://example.com)")),
    ).toBe("Hi there\n\n- one\n\n1. two (https://example.com)");
  });
});
