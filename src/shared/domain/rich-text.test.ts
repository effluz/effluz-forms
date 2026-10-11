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

  it("normalizes CRLF and drops leading and trailing blank lines", () => {
    expect(parseRichText("\r\n\r\nHi\r\n")).toEqual([{ kind: "paragraph", children: [t("Hi")] }]);
  });
});

describe("richTextToPlain", () => {
  it("writes lists with markers and links with their address", () => {
    expect(
      richTextToPlain(parseRichText("Hi **there**\n\n- one\n1. [two](https://example.com)")),
    ).toBe("Hi there\n\n- one\n\n1. two (https://example.com)");
  });
});
