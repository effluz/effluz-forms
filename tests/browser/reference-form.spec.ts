import { type ElementHandle, expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { MIN_FILL_MS } from "@/modules/submissions/application";
import { catalog } from "@/modules/submissions/presentation/copy";
import { pageAnswers, publishBilingualForm, publishReferenceForm } from "../e2e/publish";
import { syntheticJpegWithGps } from "../fakes/media-files";
import { bilingualFormDraft } from "../fixtures/bilingual-form";
import { BROWSER_E2E_BASE_URL } from "../support/app-server";

// The reference form on a phone with script enabled, in Chromium (ADR 0024). Synthetic data
// only. The script-disabled run and the budgets live in tests/e2e/. Copy comes from
// specs/ui-ux/renderer.md.

/** specs/system/security.md, "Minimum time-to-submit", plus a margin for the clocks. */
const MINIMUM_FILL_MS = MIN_FILL_MS + 500;

const publishReference = (pool: pg.Pool) => publishReferenceForm(pool, {}, BROWSER_E2E_BASE_URL);

const OFFLINE = "Parece que no tienes conexión. Continuaremos cuando vuelvas a conectarte.";
const SUBMIT_FAILED = "Tus respuestas no se enviaron. Revisa tu conexión e inténtalo de nuevo.";
const UPLOADS_PENDING = "Espera a que terminen las subidas para continuar";

function newPool(): pg.Pool {
  return new pg.Pool({ connectionString: process.env["E2E_DATABASE_URL"], max: 2 });
}

/** Checks the radio or checkbox with that value when one exists, else fills the control. */
async function fillPage(page: Page, answers: Record<string, string>): Promise<void> {
  for (const [name, value] of Object.entries(answers)) {
    // Radios and checkboxes only: a text input holding that value matches `[value]` too.
    const choice = page.locator(
      `input[name="${name}"][value="${value}"]:is([type="radio"], [type="checkbox"])`,
    );
    if ((await choice.count()) > 0) await choice.check();
    else await page.locator(`[name="${name}"]`).fill(value);
  }
}

/**
 * Opens the form and fills pages 1 to 4 with the reference answers, landing on page 5. Returns
 * the time page 1 had loaded, which is after the server rendered it (the fill's start).
 */
async function reachPhotos(page: Page, slug: string): Promise<number> {
  await page.goto(`/f/${slug}`);
  const loadedAt = Date.now();
  for (const key of ["page1", "page2", "page3", "page4"]) {
    await fillPage(page, pageAnswers(key));
    await page.locator("[data-primary]").click();
    await expect(page.locator("[data-page-heading]")).toBeFocused();
  }
  await expect(page.getByText("Página 5 de 5")).toBeVisible();
  return loadedAt;
}

/** A live region's text, or a marker when the captured element is no longer in the page. */
async function mountedText(region: ElementHandle): Promise<string | null> {
  return region.evaluate((el) => (el.isConnected ? el.textContent : "(no longer mounted)"));
}

async function syntheticPhotos(
  count: number,
): Promise<{ name: string; mimeType: string; buffer: Buffer }[]> {
  return Promise.all(
    Array.from({ length: count }, async (_, i) => ({
      name: `IMG_${String(i)}.jpg`,
      mimeType: "image/jpeg",
      buffer: Buffer.from(await syntheticJpegWithGps(64 + i, 48)),
    })),
  );
}

/**
 * Marks every control a keyboard user must reach with `data-e2e-stop` (a radio group shares
 * one mark: Tab enters it once and the arrow keys move within it) and returns the marks.
 */
async function markTabStops(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const marks = new Set<string>();
    const candidates = document.querySelectorAll<HTMLElement>(
      "a[href], button, input, select, textarea, [tabindex]",
    );
    let index = 0;
    for (const element of candidates) {
      const disabled = "disabled" in element && element.disabled === true;
      const hidden =
        element.closest('[aria-hidden="true"]') !== null ||
        (element instanceof HTMLInputElement && element.type === "hidden") ||
        element.getClientRects().length === 0;
      if (disabled || hidden || element.tabIndex < 0) continue;
      const mark =
        element instanceof HTMLInputElement && element.type === "radio"
          ? `radio:${element.name}`
          : `${element.tagName.toLowerCase()}:${String((index += 1))}`;
      element.setAttribute("data-e2e-stop", mark);
      marks.add(mark);
    }
    return [...marks];
  });
}

/** Presses `key` until focus leaves the page or comes back round; returns the marks reached. */
async function tabStops(page: Page, key: "Tab" | "Shift+Tab"): Promise<string[]> {
  const reached: string[] = [];
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.press(key);
    const mark = await page.evaluate(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) return null;
      return active.getAttribute("data-e2e-stop") ?? `unexpected:${active.outerHTML.slice(0, 80)}`;
    });
    if (mark === null || reached.includes(mark)) break;
    reached.push(mark);
  }
  return reached;
}

test("completes the reference form on a phone with script: a blur check, focus, the offline banner, early uploads, a failed Submit, Submit", async ({
  page,
  context,
}) => {
  const pool = newPool();
  try {
    const { slug, formId } = await publishReference(pool);
    await page.goto(`/f/${slug}`);
    const startedAt = Date.now();

    await page.locator('[name="email"]').fill("no-es-un-correo");
    await page.locator('[name="instagram"]').focus();
    // The bound copy row; copy.test.ts keeps it equal to specs/ui-ux/renderer.md.
    await expect(page.locator("#email-error")).toHaveText(catalog["email syntax"].es);
    await expect(page).toHaveURL(new RegExp(`/f/${slug}$`));

    for (const key of ["page1", "page2", "page3", "page4"]) {
      await fillPage(page, pageAnswers(key));
      await page.locator("[data-primary]").click();
      await expect(page.locator("[data-page-heading]")).toBeFocused();
    }
    await expect(page.getByText("Página 5 de 5")).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByText("Parece que no tienes conexión")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText("Parece que no tienes conexión")).toBeHidden();

    const files = await syntheticPhotos(2);
    await page.locator('input[type="file"][name="photos"]').setInputFiles(files);
    await expect(page.getByText("Subido", { exact: true })).toHaveCount(2);
    await expect(page.locator("#photos-count")).toHaveText("2 de 10 archivos");

    await fillPage(page, pageAnswers("page5"));
    const failure = await page.locator("[data-submit-failed]").elementHandle();
    await page.route(`**/f/${slug}`, (route) =>
      route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
    );
    await page.locator("[data-primary]").click();
    await expect(page.getByText(SUBMIT_FAILED)).toBeVisible();
    // Announced by the assertive region that was in the page before the failure.
    expect(await failure.evaluate((el) => el.isConnected && el.textContent)).toBe(SUBMIT_FAILED);
    await expect(page.locator("[data-primary]")).toBeEnabled();
    await expect(page.locator("[data-primary]")).toBeFocused();
    await expect(page.locator('[name="consent"]')).toBeChecked();
    await expect(page.locator("#photos-count")).toHaveText("2 de 10 archivos");
    await page.unroute(`**/f/${slug}`);

    // Wait out the minimum time, so this Submit is a real one (the too-fast silent accept has
    // its own case below).
    await page.waitForTimeout(Math.max(0, startedAt + MINIMUM_FILL_MS - Date.now()));
    await page.locator("[data-primary]").click();
    await expect(page.getByText("Tu referencia:")).toBeVisible();
    await expect(page.getByText("HP-0001")).toBeVisible();
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from media where form_id = $1",
      [formId],
    );
    expect(rows[0]?.n).toBe(2);
    // The confirmation cleared the drafts from session storage.
    const drafts = await page.evaluate(
      (prefix) => Object.keys(sessionStorage).filter((key) => key.startsWith(prefix)),
      `effluz:${slug}:`,
    );
    expect(drafts).toEqual([]);
  } finally {
    await pool.end();
  }
});

test("restores a draft after a reload, focuses the error summary after a refused Next, and takes Enter as Next and Back to the heading", async ({
  page,
}) => {
  const pool = newPool();
  try {
    const { slug } = await publishReference(pool);
    await page.goto(`/f/${slug}`);

    await page.locator('[name="adult_name"]').fill("Lucía Prueba Ejemplo");
    await page.reload();
    await expect(page.locator('[name="adult_name"]')).toHaveValue("Lucía Prueba Ejemplo");

    await page.locator("[data-primary]").click();
    const heading = page.locator("#error-summary-heading");
    await expect(heading).toBeFocused();
    await expect(heading).toHaveText("Corrige 3 problemas para continuar");
    await expect(page.getByRole("alert").filter({ has: heading })).toContainText(
      "Celular es obligatorio",
    );
    await expect(page.locator("[data-error-summary] a")).toHaveCount(3);
    await expect(page.locator("#phone-error")).toHaveText("Celular es obligatorio");
    await expect(page.locator('[name="phone"]')).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator('[name="phone"]')).toHaveAttribute(
      "aria-describedby",
      /\bphone-error\b/,
    );
    await expect(page.locator('[name="adult_name"]')).toHaveValue("Lucía Prueba Ejemplo");

    await fillPage(page, pageAnswers("page1"));
    await page.locator('[name="instagram"]').press("Enter");
    await expect(page.getByText("Página 2 de 5")).toBeVisible();
    await expect(page.locator("[data-page-heading]")).toBeFocused();

    await page.getByRole("button", { name: "Atrás" }).click();
    await expect(page.getByText("Página 1 de 5")).toBeVisible();
    await expect(page.locator("[data-page-heading]")).toBeFocused();
    await expect(page.locator('[name="instagram"]')).toHaveValue(
      pageAnswers("page1")["instagram"] ?? "",
    );
  } finally {
    await pool.end();
  }
});

test("waits for the connection on Next, announces it, and goes on when it returns", async ({
  page,
  context,
}) => {
  const pool = newPool();
  try {
    const { slug } = await publishReference(pool);
    await page.goto(`/f/${slug}`);
    await fillPage(page, pageAnswers("page1"));

    const banner = page.locator("[data-offline]");
    await expect(banner).toHaveText("");
    await expect(banner).toHaveAttribute("aria-live", "polite");
    const region = await banner.elementHandle();

    await context.setOffline(true);
    await expect(banner).toHaveText(OFFLINE);
    // Announced by the polite region that was in the page, empty, before the connection went.
    expect(await region.evaluate((el) => el.isConnected && el.textContent)).toBe(OFFLINE);
    await page.locator("[data-primary]").click();
    await expect(page.getByText("Página 1 de 5")).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText("Página 2 de 5")).toBeVisible();
    await expect(page.locator("[data-page-heading]")).toBeFocused();
    await expect(page.locator("[data-offline]")).toHaveText("");
  } finally {
    await pool.end();
  }
});

test("shows each upload's progress, done, failure, retry, removal and failed removal, and holds Next while one is in flight", async ({
  page,
}) => {
  const pool = newPool();
  try {
    const { slug } = await publishReference(pool);
    await reachPhotos(page, slug);
    const input = page.locator('input[type="file"][name="photos"]');
    const rows = page.locator("[data-upload] li");
    const primary = page.locator("[data-primary]");
    const [first, second] = await syntheticPhotos(2);
    if (first === undefined || second === undefined) throw new Error("no photos");
    // The live regions as mounted before any upload: each announcement must land in these
    // same elements, since a region added or replaced along with its text is not announced.
    const announce = await page.locator("[data-announce]").elementHandle();
    const alert = await page.locator("[data-alert]").elementHandle();

    // Progress, with Next waiting and saying why.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/f/${slug}/files`, async (route) => {
      await held;
      await route.continue();
    });
    await input.setInputFiles([first]);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(/Subiendo \d+\s?%/);
    await expect(rows.first().locator("img")).toBeVisible();
    await expect(primary).toBeDisabled();
    await expect(page.locator("#uploads-pending")).toHaveText(UPLOADS_PENDING);
    await expect(primary).toHaveAttribute("aria-describedby", "uploads-pending");

    // Done.
    release();
    await expect(rows.first()).toContainText("Subido");
    await expect(page.locator("[data-announce]")).toHaveText("IMG_0.jpg, Subido");
    expect(await mountedText(announce)).toBe("IMG_0.jpg, Subido");
    await expect(page.locator("#photos-count")).toHaveText("1 de 10 archivos");
    await expect(primary).toBeEnabled();
    await expect(page.locator("#uploads-pending")).toHaveCount(0);
    await page.unroute(`**/f/${slug}/files`);

    // A failed upload, then Retry.
    await page.route(`**/f/${slug}/files`, (route) => route.abort("internetdisconnected"));
    await input.setInputFiles([second]);
    const failedUpload = "IMG_1.jpg no se subió. Revisa tu conexión y reintenta";
    await expect(rows.nth(1)).toContainText(failedUpload);
    await expect(page.locator("[data-alert]")).toHaveText(failedUpload);
    expect(await mountedText(alert)).toBe(failedUpload);
    await expect(page.locator("#photos-count")).toHaveText("1 de 10 archivos");
    await page.unroute(`**/f/${slug}/files`);
    await rows.nth(1).getByRole("button", { name: "Reintentar" }).click();
    await expect(rows.nth(1)).toContainText("Subido");
    await expect(page.locator("#photos-count")).toHaveText("2 de 10 archivos");

    // A failed removal keeps the row and its Remove button.
    await page.route(`**/f/${slug}/files/*`, (route) =>
      route.request().method() === "DELETE"
        ? route.abort("internetdisconnected")
        : route.continue(),
    );
    const removeFailed = "No se pudo quitar IMG_1.jpg. Revisa tu conexión e inténtalo de nuevo";
    await rows.nth(1).getByRole("button", { name: "Quitar" }).click();
    await expect(rows.nth(1)).toContainText(removeFailed);
    await expect(page.locator("[data-alert]")).toHaveText(removeFailed);
    expect(await mountedText(alert)).toBe(removeFailed);
    await expect(rows).toHaveCount(2);
    await page.unroute(`**/f/${slug}/files/*`);

    // Removal.
    await rows.nth(1).getByRole("button", { name: "Quitar" }).click();
    await expect(rows).toHaveCount(1);
    await expect(page.locator("[data-announce]")).toHaveText("Se quitó IMG_1.jpg");
    expect(await mountedText(announce)).toBe("Se quitó IMG_1.jpg");
    await expect(page.locator("#photos-count")).toHaveText("1 de 10 archivos");
    await expect(input).toBeFocused();

    // Back after an early upload: the scripted post carries no empty file part, so nothing is
    // refused, and the uploaded photo is still there on the way forward again.
    await page.getByRole("button", { name: "Atrás" }).click();
    await expect(page.getByText("Página 4 de 5")).toBeVisible();
    await expect(page.locator("[data-page-heading]")).toBeFocused();
    await expect(page.locator("[data-error-summary]")).toHaveCount(0);
    await primary.click();
    await expect(page.getByText("Página 5 de 5")).toBeVisible();
    await expect(page.locator("[data-error-summary]")).toHaveCount(0);
    await expect(page.locator("#photos-count")).toHaveText("1 de 10 archivos");
    await expect(rows).toHaveCount(1);
  } finally {
    await pool.end();
  }
});

test("reaches every control by keyboard, the skip link first, on page 1 and on the photos page", async ({
  page,
}) => {
  const pool = newPool();
  try {
    const { slug } = await publishReference(pool);
    await page.goto(`/f/${slug}`);
    const firstPage = await markTabStops(page);
    const forward = await tabStops(page, "Tab");
    expect(forward[0]).toBe(
      await page.getByRole("link", { name: "Ir al formulario" }).getAttribute("data-e2e-stop"),
    );
    expect([...forward].sort()).toEqual([...firstPage].sort());

    await page.goto(`/f/${slug}`);
    for (const key of ["page1", "page2", "page3", "page4"]) {
      await fillPage(page, pageAnswers(key));
      await page.locator("[data-primary]").click();
      await expect(page.locator("[data-page-heading]")).toBeFocused();
    }
    const [photo] = await syntheticPhotos(1);
    if (photo === undefined) throw new Error("no photo");
    await page.locator('input[type="file"][name="photos"]').setInputFiles([photo]);
    await expect(page.locator("#photos-count")).toHaveText("1 de 10 archivos");

    const photosPage = await markTabStops(page);
    await page.locator("[data-page-heading]").focus();
    const after = await tabStops(page, "Tab");
    await page.locator("[data-page-heading]").focus();
    const before = await tabStops(page, "Shift+Tab");
    expect([...new Set([...before, ...after])].sort()).toEqual([...photosPage].sort());
    expect(photosPage.length).toBeGreaterThanOrEqual(5);
  } finally {
    await pool.end();
  }
});

test("silently accepts a Submit inside the minimum time: the decoy confirmation, and nothing stored", async ({
  page,
}) => {
  const pool = newPool();
  try {
    const { slug, formId } = await publishReference(pool);
    await reachPhotos(page, slug);
    const [photo] = await syntheticPhotos(1);
    if (photo === undefined) throw new Error("no photo");
    await page.locator('input[type="file"][name="photos"]').setInputFiles([photo]);
    await expect(page.locator("#photos-count")).toHaveText("1 de 10 archivos");
    await fillPage(page, pageAnswers("page5"));

    // The fill starts now, so the Submit below lands inside the minimum time however long the
    // pages above took on this machine.
    const moved = await pool.query(
      "update submission_in_progress set started_at = now() where form_id = $1",
      [formId],
    );
    expect(moved.rowCount).toBe(1);
    const startedAt = Date.now();
    await page.locator("[data-primary]").click();
    await expect(page.getByText("Tu referencia:")).toBeVisible();
    expect(Date.now() - startedAt).toBeLessThan(MIN_FILL_MS);

    // A decoy is shaped like a reference but is never the form's first real one, HP-0001.
    expect(await page.locator("main").innerText()).toMatch(/\bHP-[1-9]\d{3}\b/);
    const counts = await pool.query<{ submissions: number; media: number; records: number }>(
      `select (select count(*)::int from submission where form_id = $1) as submissions,
              (select count(*)::int from media where form_id = $1) as media,
              (select count(*)::int from submission_in_progress where form_id = $1) as records`,
      [formId],
    );
    expect(counts.rows[0]).toEqual({ submissions: 0, media: 0, records: 0 });
  } finally {
    await pool.end();
  }
});

// Waits for group 4's fix of final-review-c1.md item 1 (focus the confirmation heading on mount).
test("moves focus to the confirmation heading after a scripted Submit", async ({ page }) => {
  const pool = newPool();
  try {
    const { slug } = await publishReference(pool);
    const loadedAt = await reachPhotos(page, slug);
    const [photo] = await syntheticPhotos(1);
    if (photo === undefined) throw new Error("no photo");
    await page.locator('input[type="file"][name="photos"]').setInputFiles([photo]);
    await expect(page.locator("#photos-count")).toHaveText("1 de 10 archivos");
    await fillPage(page, pageAnswers("page5"));
    await page.waitForTimeout(Math.max(0, loadedAt + MINIMUM_FILL_MS - Date.now()));

    await page.locator("[data-primary]").click();
    await expect(page.getByText("HP-0001")).toBeVisible();
    await expect(page.locator("h1#page-title")).toBeFocused();
  } finally {
    await pool.end();
  }
});

test("switches the language with script and keeps html[lang] in step", async ({ page }) => {
  const pool = newPool();
  try {
    const { slug } = await publishBilingualForm(pool, {}, BROWSER_E2E_BASE_URL);
    await page.goto(`/f/${slug}`);
    const first = await page.locator("html").getAttribute("lang");
    if (first !== "en" && first !== "es") throw new Error(`unexpected html[lang] ${String(first)}`);
    const other = first === "es" ? "en" : "es";
    const heading = bilingualFormDraft.title;
    await expect(page.locator("[data-page-heading]")).toContainText(heading[first]);

    await page.locator('[name="plants"]').fill("3");
    await page.locator(`button[value="language:${other}"]`).click();
    // The switch now offers the first language back, and the page is in the other one.
    await expect(page.locator(`button[value="language:${first}"]`)).toBeVisible();
    await expect(page.locator("[data-page-heading]")).toContainText(heading[other]);
    await expect(page.locator("html")).toHaveAttribute("lang", other);
    await expect(page.locator('[name="plants"]')).toHaveValue("3");
  } finally {
    await pool.end();
  }
});
