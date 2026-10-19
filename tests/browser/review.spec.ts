import { randomUUID } from "node:crypto";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { PLAN_TIME_ZONE, addDays, todayIn } from "@/modules/review/application";
import { submitReference } from "../e2e/fill";
import { publishReferenceForm } from "../e2e/publish";
import { Staff } from "../e2e/staff";
import { seedAdminSession } from "../support/admin-session";
import { BROWSER_E2E_BASE_URL } from "../support/app-server";
import { browserDatabaseUrl } from "../support/held-database";

// Review by keyboard on a phone, in Chromium (ADR 0024): the story page, the Post plan and
// Operations. Each story is submitted over HTTP first, then a staff browser with a seeded
// session drives the manager with Tab and Enter only. Accessible names are the Spanish copy of
// specs/ui-ux/manager.md, "Fixed chrome copy" (the chrome shows English with Spanish beneath,
// so a name contains both). Synthetic data only.

const base = BROWSER_E2E_BASE_URL;
const SESSION_COOKIE = "effluz_admin_session";
const CORRECTED = "Una historia inventada, corregida para pruebas.";
const POST_URL = "https://www.instagram.com/p/prueba-teclado/";

let pool: pg.Pool;

test.beforeAll(() => {
  pool = new pg.Pool({ connectionString: browserDatabaseUrl(), max: 2 });
});
test.afterAll(async () => {
  await pool.end();
});

/** A day in America/Panama, `n` days from today. */
const dayFromToday = (n: number) => addDays(todayIn(PLAN_TIME_ZONE, new Date()), n);

/** Seeds an admin session and hands its cookie to the browser, as a sign-in would. */
async function signIn(context: BrowserContext): Promise<{ sessionId: string; csrf: string }> {
  const session = await seedAdminSession(pool, { email: "owner@example.com" });
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: session.sessionId,
      domain: "127.0.0.1",
      path: "/admin",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
  return session;
}

/** A post-plan reference form with one story submitted over HTTP. */
async function seedStory(
  photoCount = 1,
): Promise<{ formId: string; reference: string; submissionId: string; path: string }> {
  const { formId, slug } = await publishReferenceForm(pool, { usePostPlan: true }, base);
  const { reference, submissionId } = await submitReference(pool, slug, photoCount, base);
  return {
    formId,
    reference,
    submissionId,
    path: `/admin/forms/${formId}/submissions/${reference}`,
  };
}

/** What a Tab reached: its accessible name, its element, whether it shows a focus indicator. */
interface Stop {
  name: string;
  tag: string;
  type: string | null;
  href: string | null;
  text: string;
  ring: boolean;
  day: string | null;
  action: string | null;
  job: string | null;
  animations: string[];
  mark: string;
  seen: boolean;
}

/** The first line of an ARIA snapshot, `- role "name" ...`, gives the name. */
function nameOf(snapshot: string): string {
  const first = snapshot.split("\n")[0] ?? "";
  const quoted = /^- [a-z]+ ("(?:[^"\\]|\\.)*")/.exec(first)?.[1];
  return quoted === undefined ? "" : (JSON.parse(quoted) as string);
}

/** The element that has focus, or null when focus is on the page itself. */
async function focused(page: Page): Promise<Stop | null> {
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return null;
    const seen = el.hasAttribute("data-e2e-stop");
    if (!seen)
      el.setAttribute("data-e2e-stop", String(document.querySelectorAll("[data-e2e-stop]").length));
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
    const form = el.closest("form");
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type"),
      href: el.getAttribute("href"),
      text: el.textContent,
      ring: outline || style.boxShadow !== "none",
      day: el.closest("[data-day]")?.getAttribute("data-day") ?? null,
      action: form?.getAttribute("action") ?? null,
      job: form?.querySelector<HTMLInputElement>('input[name="job"]')?.value ?? null,
      animations: document
        .getAnimations()
        .filter((a) => a.playState === "running")
        .map((a) =>
          a instanceof CSSAnimation
            ? `animation ${a.animationName}`
            : a instanceof CSSTransition
              ? `transition ${a.transitionProperty}`
              : "animation",
        ),
      mark: el.getAttribute("data-e2e-stop") ?? "",
      seen,
    };
  });
  if (info === null) return null;
  // A role-less element (a `<summary>`) has no quoted name in the snapshot: its text names it.
  const name =
    nameOf(await page.locator(":focus").ariaSnapshot({ timeout: 2_000 })) ||
    info.text.replace(/\s+/g, " ").trim();
  return { ...info, name };
}

/**
 * Presses Tab from the top of the page until focus leaves the page or comes back to an element
 * it already reached; returns the stops in order. A date field holds focus for its parts, so
 * staying on the same element is not a cycle.
 */
async function tabThrough(page: Page): Promise<Stop[]> {
  const stops: Stop[] = [];
  for (let i = 0; i < 300; i += 1) {
    await page.keyboard.press("Tab");
    const stop = await focused(page);
    if (stop === null) break;
    if (stop.seen) {
      if (stops.at(-1)?.mark === stop.mark) continue;
      break;
    }
    stops.push(stop);
  }
  return stops;
}

/** Presses Tab until the focused element matches; fails when none does. */
async function tabTo(page: Page, match: (stop: Stop) => boolean, what: string): Promise<Stop> {
  for (let i = 0; i < 400; i += 1) {
    await page.keyboard.press("Tab");
    const stop = await focused(page);
    if (stop !== null && match(stop)) return stop;
  }
  throw new Error(`Tab never reached ${what}`);
}

const named = (text: string) => (stop: Stop) => stop.name.includes(text);

/** Presses Enter on the focused link or button and waits for the page it loads. */
async function enter(page: Page): Promise<void> {
  await Promise.all([page.waitForEvent("load"), page.keyboard.press("Enter")]);
}

/** The wanted names in the order the stops reach them (each after the one before). */
function inOrder(names: string[], wanted: string[]): string[] {
  const found: string[] = [];
  let from = 0;
  for (const text of wanted) {
    const at = names.findIndex((name, i) => i >= from && name.includes(text));
    if (at === -1) break;
    found.push(text);
    from = at + 1;
  }
  return found;
}

test("the owner corrects, chooses, ticks, plans and publishes with the keyboard", async ({
  page,
  context,
}) => {
  await signIn(context);
  const { path } = await seedStory(1);
  const tomorrow = dayFromToday(1);

  await page.goto(path);
  const stops = await tabThrough(page);
  expect(stops[0]?.name).toContain("Saltar al contenido principal");
  const wanted = [
    "Editar",
    "Elegir para la publicación",
    "Marcar fotos como editadas",
    "Planificar",
    "Marcar como publicada",
    "Eliminar respuesta",
  ];
  expect(
    inOrder(
      stops.map((s) => s.name),
      wanted,
    ),
  ).toEqual(wanted);
  expect(stops.filter((s) => !s.ring).map((s) => `${s.tag} "${s.name}"`)).toEqual([]);

  // Correct the story.
  await page.goto(path);
  await tabTo(
    page,
    (s) => s.name.includes("Editar") && (s.href ?? "").includes("edit=story"),
    "Editar",
  );
  await enter(page);
  await tabTo(page, (s) => s.tag === "textarea", "the corrected text");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(CORRECTED);
  await tabTo(page, named("Guardar corrección"), "Guardar corrección");
  await enter(page);
  await expect(page.getByRole("status").filter({ hasText: "Corrección guardada" })).toBeVisible();

  // Choose the photo.
  await tabTo(page, named("Elegir para la publicación"), "Elegir para la publicación");
  await enter(page);
  await expect(page.locator("#photos li").filter({ hasText: "Foto 1 de 1" })).toContainText(
    "Elegida para la publicación",
  );

  // Tick the photos as edited.
  await tabTo(page, named("Marcar fotos como editadas"), "Marcar fotos como editadas");
  await enter(page);
  await expect(
    page.locator("#readiness li").filter({ hasText: "Fotos editadas en Canva" }),
  ).toContainText("Hecho");

  // Plan it for tomorrow.
  await tabTo(page, (s) => s.tag === "input" && s.type === "date", "the planned date");
  await page.locator(":focus").fill(tomorrow);
  await tabTo(page, named("Planificar"), "Planificar");
  await enter(page);
  await expect(page.getByText(`Planificada · ${tomorrow}`, { exact: true })).toBeVisible();

  // Mark it as published with the link to the post.
  await tabTo(page, named("Marcar como publicada"), "Marcar como publicada");
  await enter(page);
  await tabTo(page, (s) => s.tag === "input" && s.type === "url", "the post link");
  await page.keyboard.type(POST_URL);
  await tabTo(page, named("Confirmar"), "Confirmar");
  await enter(page);
  await expect(page.getByText(`Publicada el ${tomorrow}`, { exact: true })).toBeVisible();
});

test("the post plan picks a story for an empty day by keyboard", async ({ page, context }) => {
  await signIn(context);
  const { formId, reference, submissionId, path } = await seedStory(1);
  // A week wholly in the future that no other case of this file plans in.
  const inWeek = dayFromToday(14);

  await page.goto(`/admin/plan?week=${inWeek}`);
  const pick = await tabTo(page, named("Elegir una historia"), "Elegir una historia");
  const day = pick.day;
  if (day === null) throw new Error("the pick link is not inside a day");
  expect(day > dayFromToday(1)).toBe(true);
  await enter(page);
  await tabTo(
    page,
    (s) => s.name.includes(`Planificar para el ${day}`) && s.action === `${path}/plan`,
    `Planificar para el ${day}`,
  );
  await enter(page);

  const dayRow = page.locator(`li[data-day="${day}"]`);
  await expect(dayRow.getByRole("link", { name: reference })).toHaveAttribute(
    "href",
    `/admin/forms/${formId}/submissions/${reference}`,
  );
  const { rows } = await pool.query<{ planned_on: string | null }>(
    "select planned_on::text as planned_on from story where submission_id = $1",
    [submissionId],
  );
  expect(rows[0]?.planned_on).toBe(day);
});

test("compare changes are reachable with Tab", async ({ page, context }) => {
  const session = await signIn(context);
  const { path } = await seedStory(1);
  const corrected = await new Staff(base, session).post(`${path}/correction`, {
    field: "story",
    text: CORRECTED,
    back: "",
  });
  expect(corrected.status).toBe(303);

  await page.goto(`${path}?compare=story`);
  const changes = await page.locator("ins, del").count();
  expect(changes).toBeGreaterThan(0);
  const reached = (await tabThrough(page)).filter((s) => s.tag === "ins" || s.tag === "del");
  expect(reached).toHaveLength(changes);
  expect(reached.some((s) => s.tag === "ins")).toBe(true);
  expect(reached.some((s) => s.tag === "del")).toBe(true);
  for (const change of reached) {
    expect(change.text).toContain(change.tag === "ins" ? "Agregado" : "Quitado");
  }
});

test("reduced motion is respected", async ({ page, context }) => {
  await signIn(context);
  const { path } = await seedStory(1);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.goto(path);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
    true,
  );
  const running = () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running")
        .map((a) => a.constructor.name),
    );
  expect(await running()).toEqual([]);
  // Focus and hover change the controls' colours, which run a transition without reduced motion.
  const stops = await tabThrough(page);
  expect(stops.flatMap((s) => s.animations)).toEqual([]);
  for (const control of await page.locator("main a, main button").all()) {
    if (!(await control.isVisible())) continue;
    await control.hover();
    expect(await running()).toEqual([]);
  }
});

test("Operations retries a dead job by keyboard", async ({ page, context }) => {
  await signIn(context);
  const id = randomUUID();
  await pool.query(
    `insert into job (id, type, payload, status, attempts, max_attempts, last_error, finished_at)
     values ($1, 'jobs.cleanup', '{}', 'dead', 8, 8, 'synthetic failure', now())`,
    [id],
  );

  await page.goto("/admin/operations");
  await tabTo(page, (s) => s.name.includes("Reintentar") && s.job === id, "Reintentar");
  await enter(page);
  await expect(
    page.getByRole("status").filter({ hasText: "El trabajo se ejecutará de nuevo en breve." }),
  ).toBeVisible();
  const { rows } = await pool.query<{ status: string }>("select status from job where id = $1", [
    id,
  ]);
  expect(rows[0]?.status).toBe("pending");
});
