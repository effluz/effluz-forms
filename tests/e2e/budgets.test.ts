import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, inject, it } from "vitest";
import { createPool } from "@/shared/infrastructure/postgres/pool";
import { Visitor } from "./http";
import { pageAnswers, publishReferenceForm } from "./publish";

// The renderer's performance targets against the built app.
// See specs/ui-ux/renderer.md, "Performance targets".

const pool = createPool(inject("databaseUrl"), { max: 2 });
afterAll(async () => {
  await pool.end();
});

const KB = 1024;
const HTML_BUDGET = 30 * KB;
const SCRIPT_BUDGET = 150 * KB;
const RENDER_BUDGET_MS = 200;

/**
 * Every `<script src>` and every `<link rel="preload|modulepreload" as="script" href>` of a
 * page, once each. A `noModule` script (Next's legacy polyfills) is left out: the browsers the
 * renderer supports run modules and never fetch it.
 */
function scriptUrls(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)) {
    if (/\bnomodule\b/i.test(match[0])) continue;
    if (match[1] !== undefined) urls.add(match[1]);
  }
  for (const match of html.matchAll(/<link\b[^>]*>/g)) {
    const tag = match[0];
    const rel = /\brel="([^"]+)"/.exec(tag)?.[1];
    const as = /\bas="([^"]+)"/.exec(tag)?.[1];
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
    if ((rel === "preload" || rel === "modulepreload") && as === "script" && href) urls.add(href);
  }
  return [...urls].map((url) => url.replace(/&amp;/g, "&"));
}

describe("the renderer budgets", () => {
  it("keeps every page's HTML under 30 KB and all their scripts under 150 KB, compressed", async () => {
    const { slug } = await publishReferenceForm(pool);
    const v = new Visitor(inject("baseUrl"));
    const pages: { page: string; html: string }[] = [];
    for (const page of ["page1", "page2", "page3", "page4"]) {
      const { html } = await v.get(`/f/${slug}`);
      pages.push({ page, html });
      const next = await v.submit(html, { _action: "next", ...pageAnswers(page) });
      expect(next.status, page).toBe(303);
    }
    pages.push({ page: "page5", html: (await v.get(`/f/${slug}`)).html });

    for (const { page, html } of pages) {
      const size = gzipSync(html).length;
      expect(size, `${page}: ${String(size)} bytes of gzip HTML`).toBeLessThan(HTML_BUDGET);
    }

    // The method: the union of the scripts the five pages make the browser load (see
    // `scriptUrls`), so a chunk only one page loads (the photos page's upload field) counts too;
    // each body fetched from the app once, gzipped on its own at the default level, and the
    // sizes summed. KB is 1024 bytes. The failure message carries the measured total.
    const urls = [...new Set(pages.flatMap(({ html }) => scriptUrls(html)))];
    expect(urls.length).toBeGreaterThan(0);
    let total = 0;
    for (const url of urls) {
      const response = await fetch(new URL(url, inject("baseUrl")));
      expect(response.status, url).toBe(200);
      total += gzipSync(new Uint8Array(await response.arrayBuffer())).length;
    }
    expect(
      total,
      `${String(total)} bytes of gzip script over ${String(urls.length)} files, the union of the five pages' scripts`,
    ).toBeLessThan(SCRIPT_BUDGET);
  });

  // One retry for this case only: a shared runner can stall for a moment; two slow runs in a
  // row are a finding.
  it("renders page 1 in under 200 ms at the 95th percentile", { retry: 1 }, async () => {
    const { slug } = await publishReferenceForm(pool);
    const v = new Visitor(inject("baseUrl"));
    for (let i = 0; i < 5; i += 1) await v.get(`/f/${slug}`);
    const samples: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const started = performance.now();
      const { status } = await v.get(`/f/${slug}`);
      samples.push(performance.now() - started);
      expect(status).toBe(200);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(40 * 0.95) - 1] ?? Infinity;
    // The method: 40 sequential GETs of page 1 after 5 warm-ups, timed to the end of the body;
    // the 38th fastest is the 95th percentile.
    expect(
      p95,
      `p95 ${p95.toFixed(1)} ms over 40 sequential GETs of page 1 after 5 warm-ups`,
    ).toBeLessThan(RENDER_BUDGET_MS);
  });
});
