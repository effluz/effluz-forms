import type { Pool } from "pg";
import { syntheticJpegWithGps } from "../fakes/media-files";
import { textOf, Visitor } from "./http";
import { pageAnswers } from "./publish";

/**
 * Fills the reference form (tests/fixtures/reference-form.ts) over HTTP as a browser without
 * script does, against the app at `base`. Plain throws instead of test-runner assertions, so
 * the HTTP suite (Vitest) and the browser suite (Playwright) can both use it.
 * Synthetic data only.
 */

/** The renderer refuses a submission sent sooner than this after page 1 rendered. */
export const MINIMUM_TIME_MS = 3_200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `n` synthetic JPEGs (with GPS metadata the app must strip), each a different size. */
export async function photos(n: number): Promise<File[]> {
  const out: File[] = [];
  for (let i = 0; i < n; i += 1) {
    const bytes = new Uint8Array(await syntheticJpegWithGps(64 + i, 48));
    out.push(new File([bytes], `IMG_${String(i)}.jpg`, { type: "image/jpeg" }));
  }
  return out;
}

/** The files as the reference form's upload field posts them. */
export const asFiles = (list: readonly File[]) => list.map((file) => ({ field: "photos", file }));

/** Waits until the minimum time since page 1 rendered has passed. */
export async function waitForMinimumTime(renderedAt: number): Promise<void> {
  const left = renderedAt + MINIMUM_TIME_MS - Date.now();
  if (left > 0) await sleep(left);
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Fills pages 1 to 4 with the reference answers and opens page 5. */
export async function fillToPhotos(
  slug: string,
  base: string,
): Promise<{ v: Visitor; renderedAt: number; html: string }> {
  const v = new Visitor(base);
  const first = await v.get(`/f/${slug}`);
  check(first.status === 200, `page 1 answered ${String(first.status)}`);
  check(textOf(first.html).includes("Historias"), "page 1 does not show the form title");
  const renderedAt = Date.now();
  let html = first.html;
  for (const page of ["page1", "page2", "page3", "page4"]) {
    if (page !== "page1") html = (await v.get(`/f/${slug}`)).html;
    const next = await v.submit(html, { _action: "next", "website-url": "", ...pageAnswers(page) });
    check(next.status === 303, `${page}: Next answered ${String(next.status)}`);
    check(next.location === `/f/${slug}`, `${page}: Next went to ${String(next.location)}`);
  }
  const last = await v.get(`/f/${slug}`);
  check(textOf(last.html).includes("Página 5 de 5"), "page 5 did not open");
  return { v, renderedAt, html: last.html };
}

/** Fills and submits the reference form with `photos` synthetic JPEGs; returns the stored reference and id. */
export async function submitReference(
  pool: Pool,
  slug: string,
  photoCount: number,
  base: string,
): Promise<{ reference: string; submissionId: string }> {
  const { v, renderedAt, html } = await fillToPhotos(slug, base);
  await waitForMinimumTime(renderedAt);
  const sent = await v.submit(
    html,
    { _action: "submit", "website-url": "", ...pageAnswers("page5") },
    asFiles(await photos(photoCount)),
  );
  check(sent.status === 303, `Submit answered ${String(sent.status)}`);
  check(/^done\./.test(v.cookie() ?? ""), "Submit did not reach the confirmation");
  const { rows } = await pool.query<{ id: string; reference: string }>(
    `select s.id, s.reference from submission s join form f on f.id = s.form_id
      where f.slug = $1 order by s.received_at desc limit 1`,
    [slug],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("the submission was not stored");
  return { reference: row.reference, submissionId: row.id };
}
