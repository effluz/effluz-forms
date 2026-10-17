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

describe("hostile hrefs and styles", () => {
  const hostile = 'https://example.com/?q="><script>x</script>&x=<b>';

  it("escapes quotes and angle brackets in an https href in both renderings", () => {
    const blocks = parseRichText(`[go](${hostile})`);
    expect(JSON.stringify(blocks)).toContain('"link"');
    const react = renderToStaticMarkup(createElement(RichText, { source: `[go](${hostile})` }));
    const html = richTextToHtml(blocks, { link: "color:#372549", paragraph: "margin:0" });
    for (const out of [react, html]) {
      expect(out).not.toContain("<script");
      expect(out).toContain("&quot;&gt;&lt;script&gt;");
    }
  });

  it("keeps non-https, uppercase, credentialed and nested javascript links inert", () => {
    for (const source of [
      "[x](HTTPS://example.com/)",
      "[x](https://user:pw@example.com/)",
      "**[x](javascript:alert(1))**",
      "_[x](javascript:alert(1))_",
    ]) {
      const react = renderToStaticMarkup(createElement(RichText, { source }));
      const html = richTextToHtml(parseRichText(source), { link: "c:d", paragraph: "m:0" });
      expect(react).not.toContain("<a ");
      expect(html).not.toContain("<a ");
    }
  });

  it("escapes the caller's styles so the function is string-safe on its own", () => {
    const html = richTextToHtml(parseRichText("[a](https://example.com)\n\n- b"), {
      link: 'x" onclick="evil',
      paragraph: 'y"><i',
    });
    expect(html).not.toContain('" onclick="');
    expect(html).not.toContain('"><i');
    expect(html).toContain('style="x&quot; onclick=&quot;evil"');
    expect(html).toContain('<p style="y&quot;&gt;&lt;i">');
  });
});
