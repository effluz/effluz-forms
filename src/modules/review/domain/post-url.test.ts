import { describe, expect, it } from "vitest";
import { POST_URL_MAX, parsePostUrl } from "./post-url";

describe("post link", () => {
  it("accepts https links and blanks only", () => {
    expect(parsePostUrl("")).toEqual({ ok: true, url: null });
    expect(parsePostUrl("   ")).toEqual({ ok: true, url: null });
    expect(parsePostUrl(" https://www.instagram.com/p/abc/ ")).toEqual({
      ok: true,
      url: "https://www.instagram.com/p/abc/",
    });

    expect(parsePostUrl("http://x.example")).toEqual({ ok: false });
    expect(parsePostUrl("javascript:alert(1)")).toEqual({ ok: false });
    expect(parsePostUrl("https://")).toEqual({ ok: false });
    expect(parsePostUrl("instagram.com/p/abc")).toEqual({ ok: false });

    const prefix = "https://x.example/";
    const atLimit = prefix + "a".repeat(POST_URL_MAX - prefix.length);
    expect(atLimit).toHaveLength(2048);
    expect(parsePostUrl(atLimit)).toEqual({ ok: true, url: atLimit });
    expect(parsePostUrl(atLimit + "a")).toEqual({ ok: false });
  });

  it("refuses a link that does not start with https:// and its host", () => {
    expect(parsePostUrl("https:example.com")).toEqual({ ok: false });
    expect(parsePostUrl("https:/example.com")).toEqual({ ok: false });
    expect(parsePostUrl("https:///foo")).toEqual({ ok: false });
    expect(parsePostUrl("https:\\\\x.example/p")).toEqual({ ok: false });
    expect(parsePostUrl("HTTPS://x.example/p")).toEqual({ ok: true, url: "HTTPS://x.example/p" });
  });

  it("refuses a link with spaces or control characters inside", () => {
    expect(parsePostUrl("https://x.example/a b")).toEqual({ ok: false });
    expect(parsePostUrl("https://x.example/a\nb")).toEqual({ ok: false });
  });
});
