import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseRichText } from "@/shared/domain/rich-text";
import { RichText } from "./RichText";
import { escapeHtml, richTextToHtml } from "./rich-text-html";

describe("RichText", () => {
  it("renders paragraphs, lists and links that open safely, escaping text", () => {
    const html = renderToStaticMarkup(
      createElement(RichText, { source: "<i>x</i> **b**\n\n- [l](https://example.com)" }),
    );
    expect(html).toBe(
      '<div><p>&lt;i&gt;x&lt;/i&gt; <strong>b</strong></p><ul><li><a href="https://example.com" target="_blank" rel="noopener">l</a></li></ul></div>',
    );
  });
});

describe("richTextToHtml", () => {
  it("escapes text and attributes and applies the fixed inline styles", () => {
    const html = richTextToHtml(parseRichText('"q" & [a](https://example.com/?a=1&b=2)'), {
      link: "color:#372549",
      paragraph: "margin:0 0 16px",
    });
    expect(html).toBe(
      '<p style="margin:0 0 16px">&quot;q&quot; &amp; <a href="https://example.com/?a=1&amp;b=2" style="color:#372549">a</a></p>',
    );
    expect(escapeHtml("<'>")).toBe("&lt;&#39;&gt;");
  });
});
