import { readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, inject, it } from "vitest";
import { applyLifecycle } from "@/modules/definitions/application";
import { catalog } from "@/modules/submissions/presentation/copy";
import { createPool } from "@/shared/infrastructure/postgres/pool";
import { syntheticJpegWithGps, syntheticMp4 } from "../fakes/media-files";
import { textOf, Visitor } from "./http";
import { pageAnswers, publishReferenceForm } from "./publish";

// The reference form against the built app, as a browser without script fills it in.
// See specs/use-cases/reference-form-preemie-stories.md and specs/ui-ux/renderer.md, "Routes".

const pool = createPool(inject("databaseUrl"), { max: 2 });
afterAll(async () => {
  await pool.end();
});

const MINIMUM_TIME_MS = 3_200;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function count(sql: string, args: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(sql, args);
  return rows[0]?.n ?? 0;
}

/**
 * Every staged file (a name with a dot) of one in-progress record: the files under
 * `in-progress/<id>/` of the app's staging directory, where `id` is the `effluz_fill` value.
 * Scoped to the record, so files other cases leave behind never count.
 */
async function stagedFiles(recordId: string | null): Promise<string[]> {
  if (recordId === null || !/^[0-9a-f-]{36}$/.test(recordId)) throw new Error("no record cookie");
  try {
    const names = await readdir(path.join(inject("stagingDir"), "in-progress", recordId), {
      recursive: true,
    });
    return names.filter((name) => path.basename(name).includes("."));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function photos(n: number): Promise<File[]> {
  const out: File[] = [];
  for (let i = 0; i < n; i += 1) {
    const bytes = new Uint8Array(await syntheticJpegWithGps(64 + i, 48));
    out.push(new File([bytes], `IMG_${String(i)}.jpg`, { type: "image/jpeg" }));
  }
  return out;
}

const video = (): File =>
  new File([new Uint8Array(syntheticMp4())], "mensaje.mp4", { type: "video/mp4" });

const asFiles = (list: readonly File[]) => list.map((file) => ({ field: "photos", file }));

async function waitForMinimumTime(renderedAt: number): Promise<void> {
  const left = renderedAt + MINIMUM_TIME_MS - Date.now();
  if (left > 0) await sleep(left);
}

const refusedAt = (slug: string) => new RegExp(`^/f/${slug}\\?refused=\\d+$`);

/** Fills pages 1 to 4 with the reference answers and opens page 5. */
async function fillToPhotos(
  slug: string,
): Promise<{ v: Visitor; renderedAt: number; html: string }> {
  const v = new Visitor(inject("baseUrl"));
  const first = await v.get(`/f/${slug}`);
  expect(first.status).toBe(200);
  expect(textOf(first.html)).toContain("Historias");
  const renderedAt = Date.now();
  let html = first.html;
  for (const page of ["page1", "page2", "page3", "page4"]) {
    if (page !== "page1") html = (await v.get(`/f/${slug}`)).html;
    const next = await v.submit(html, { _action: "next", "website-url": "", ...pageAnswers(page) });
    expect(next.status, page).toBe(303);
    expect(next.location, page).toBe(`/f/${slug}`);
  }
  const last = await v.get(`/f/${slug}`);
  expect(textOf(last.html)).toContain("Página 5 de 5");
  return { v, renderedAt, html: last.html };
}

describe("the reference form without script", () => {
  it("is completed with nine photos and a video, and stored with its media rows and jobs", async () => {
    const { slug, formId } = await publishReferenceForm(pool);
    const { v, renderedAt, html } = await fillToPhotos(slug);
    await waitForMinimumTime(renderedAt);

    const tooMany = await v.submit(
      html,
      { _action: "submit", "website-url": "", ...pageAnswers("page5") },
      asFiles([...(await photos(10)), video()]),
    );
    expect(tooMany.status).toBe(303);
    expect(tooMany.location).toMatch(refusedAt(slug));
    const refusedPage = await v.get(tooMany.location ?? "");
    expect(textOf(refusedPage.html)).toContain(
      "Puedes subir hasta 10 archivos en Sube hasta 10 fotos sin editar del bebé",
    );
    expect(textOf(refusedPage.html)).toContain("Corrige 1 problema para continuar");
    expect(
      await count("select count(*)::int as n from submission where form_id = $1", [formId]),
    ).toBe(0);
    const recordId = v.cookie();
    expect(await stagedFiles(recordId)).toHaveLength(0);

    const sent = await v.submit(
      refusedPage.html,
      { _action: "submit", "website-url": "", ...pageAnswers("page5") },
      asFiles([...(await photos(9)), video()]),
    );
    expect(sent.status).toBe(303);
    expect(v.cookie()).toMatch(/^done\./);

    const confirmation = await v.get(`/f/${slug}`);
    expect(textOf(confirmation.html)).toContain("Gracias por la información.");
    expect(textOf(confirmation.html)).toContain("Tu referencia:");
    expect(textOf(confirmation.html)).toContain("HP-0001");

    const {
      rows: [submission],
    } = await pool.query<{
      id: string;
      reference: string;
      locale: string;
      answers: Record<string, unknown>;
    }>("select id, reference, locale, answers from submission where form_id = $1", [formId]);
    expect(submission).toMatchObject({ reference: "HP-0001", locale: "es" });
    expect((submission?.answers["photos"] as string[]).length).toBe(10);
    const media = await pool.query<{
      kind: string;
      content_type: string;
      durable_key: string;
      staging_ref: string;
    }>(
      "select kind, content_type, durable_key, staging_ref from media where submission_id = $1 order by position",
      [submission?.id],
    );
    expect(media.rows).toHaveLength(10);
    // The staged files sit under the record's own prefix, which `stagedFiles` reads; no worker
    // runs here, so all ten are still there.
    expect(await stagedFiles(recordId)).toHaveLength(10);
    for (const row of media.rows)
      expect(row.staging_ref).toMatch(new RegExp(`^in-progress/${recordId ?? "none"}/`));
    expect(media.rows[0]?.durable_key).toBe(
      `forms/${slug}/HP-0001/01-sube-hasta-10-fotos-sin-editar-del-bebe.jpg`,
    );
    expect(media.rows[9]).toMatchObject({ kind: "video", content_type: "video/mp4" });
    expect(media.rows[9]?.durable_key).toBe(
      `forms/${slug}/HP-0001/10-sube-hasta-10-fotos-sin-editar-del-bebe.mp4`,
    );
    for (const row of media.rows.filter((r) => r.kind === "image")) {
      const meta = await sharp(path.join(inject("stagingDir"), row.staging_ref)).metadata();
      expect(meta.exif, row.staging_ref).toBeUndefined();
    }
    const jobs = await pool.query<{ type: string; payload: Record<string, unknown> }>(
      `select type, payload from job
        where payload->>'submissionId' = $1
           or payload->>'mediaId' in (select id::text from media where submission_id = $1::uuid)
        order by type`,
      [submission?.id],
    );
    expect(jobs.rows.filter((j) => j.type === "media.upload")).toHaveLength(10);
    expect(jobs.rows.filter((j) => j.type === "email.staff_notification")).toEqual([
      { type: "email.staff_notification", payload: { submissionId: submission?.id } },
    ]);
    expect(jobs.rows.filter((j) => j.type === "email.submitter_confirmation")).toEqual([]);
    expect(
      await count("select count(*)::int as n from submission_in_progress where form_id = $1", [
        formId,
      ]),
    ).toBe(0);

    const back = await v.get(`/f/${slug}`);
    expect(textOf(back.html)).toContain("HP-0001");
  });

  it("redirects an invalid page back to itself with the error summary and what was typed", async () => {
    const { slug } = await publishReferenceForm(pool);
    const v = new Visitor(inject("baseUrl"));
    const first = await v.get(`/f/${slug}`);
    const refused = await v.submit(first.html, {
      _action: "next",
      "website-url": "",
      ...pageAnswers("page1"),
      adult_name: "",
      email: "no-es-un-correo",
    });
    expect(refused.status).toBe(303);
    expect(refused.location).toMatch(refusedAt(slug));
    const page = await v.get(refused.location ?? "");
    const text = textOf(page.html);
    expect(text).toContain("Corrige 2 problemas para continuar");
    expect(text).toContain("Nombre y apellido completo del adulto responsable es obligatorio");
    // The bound copy row; copy.test.ts keeps it equal to specs/ui-ux/renderer.md.
    expect(text).toContain(catalog["email syntax"].es);
    expect(page.html).toContain('value="no-es-un-correo"');
  });

  it("names a refused file only on the page its post redirects to", async () => {
    const { slug, formId } = await publishReferenceForm(pool);
    const { v, renderedAt, html } = await fillToPhotos(slug);
    await waitForMinimumTime(renderedAt);

    const refused = await v.submit(
      html,
      { _action: "next", "website-url": "", ...pageAnswers("page5") },
      [
        {
          field: "photos",
          file: new File(["solo texto"], "notas-privadas.jpg", { type: "image/jpeg" }),
        },
      ],
    );
    expect(refused.status).toBe(303);
    expect(refused.location).toMatch(refusedAt(slug));
    expect(v.cookie("effluz_fill_state")).not.toBeNull();

    const page = await v.get(refused.location ?? "");
    expect(textOf(page.html)).toContain("notas-privadas.jpg no es un tipo permitido");
    expect(
      await count(
        `select count(*)::int as n from submission_in_progress
          where form_id = $1 and (pending::text like '%notas-privadas%' or files::text like '%notas-privadas%')`,
        [formId],
      ),
    ).toBe(0);
    const plain = await v.get(`/f/${slug}`);
    expect(plain.html).not.toContain("notas-privadas");

    const back = await v.submit(page.html, { _action: "back", "website-url": "" });
    expect(back.status).toBe(303);
    expect(back.location).toBe(`/f/${slug}`);
    expect(v.cookie("effluz_fill_state")).toBeNull();
    // Back lands on page 4 with its stored answers.
    const previous = await v.get(`/f/${slug}`);
    expect(textOf(previous.html)).toContain("Página 4 de 5");
    expect(textOf(previous.html)).toContain(pageAnswers("page4")["story"] ?? "no story");
    const checkedSource = [...previous.html.matchAll(/<input\b[^>]*\bname="source"[^>]*>/g)]
      .map((match) => match[0])
      .filter((tag) => /\bchecked\b/.test(tag));
    expect(checkedSource).toEqual([
      expect.stringContaining(`value="${pageAnswers("page4")["source"] ?? "none"}"`),
    ]);
  });

  it("refuses a submission once the form is closed, even from a tab opened before", async () => {
    const { slug, formId, deps } = await publishReferenceForm(pool);
    const { v, renderedAt, html } = await fillToPhotos(slug);
    const closed = await applyLifecycle(
      deps,
      { email: "editor@example.com", ip: "203.0.113.7" },
      { formId, action: "close" },
    );
    expect(closed.ok).toBe(true);
    await waitForMinimumTime(renderedAt);

    const sent = await v.submit(
      html,
      { _action: "submit", "website-url": "", ...pageAnswers("page5") },
      asFiles(await photos(1)),
    );
    expect(sent.status).toBe(303);
    const after = await v.get(sent.location ?? `/f/${slug}`);
    expect(textOf(after.html)).toContain("Este formulario está cerrado");
    expect(
      await count("select count(*)::int as n from submission where form_id = $1", [formId]),
    ).toBe(0);
  });

  it("answers a repeated Submit with the same confirmation and one submission", async () => {
    const { slug, formId } = await publishReferenceForm(pool);
    const { v, renderedAt, html } = await fillToPhotos(slug);
    await waitForMinimumTime(renderedAt);

    const fields = { _action: "submit", "website-url": "", ...pageAnswers("page5") };
    // Both file lists are built first, so the two posts leave together.
    const firstFiles = asFiles(await photos(1));
    const secondFiles = asFiles(await photos(1));
    const [one, two] = await Promise.all([
      v.submit(html, fields, firstFiles),
      v.submit(html, fields, secondFiles),
    ]);
    expect(one.status).toBe(303);
    expect(two.status).toBe(303);
    expect(
      await count("select count(*)::int as n from submission where form_id = $1", [formId]),
    ).toBe(1);
    const confirmation = await v.get(`/f/${slug}`);
    expect(textOf(confirmation.html)).toContain("HP-0001");
  });

  it("silently accepts a filled honeypot: the confirmation, and nothing stored", async () => {
    const { slug, formId } = await publishReferenceForm(pool);
    const { v, renderedAt, html } = await fillToPhotos(slug);
    await waitForMinimumTime(renderedAt);

    const sent = await v.submit(
      html,
      { _action: "submit", "website-url": "https://spam.example", ...pageAnswers("page5") },
      asFiles(await photos(2)),
    );
    expect(sent.status).toBe(303);
    const confirmation = await v.get(`/f/${slug}`);
    expect(textOf(confirmation.html)).toMatch(/Tu referencia: HP-\d{4}/);
    expect(
      await count("select count(*)::int as n from submission where form_id = $1", [formId]),
    ).toBe(0);
    expect(await count("select count(*)::int as n from media where form_id = $1", [formId])).toBe(
      0,
    );
    expect(
      await count("select count(*)::int as n from submission_in_progress where form_id = $1", [
        formId,
      ]),
    ).toBe(0);
  });

  // Not 404: under the renderer's root layout Next answers `notFound()` with an empty error
  // document, so the page renders the not-found screen itself with status 200 and `noindex`
  // (Task 28, Deviations 1). Paths outside the renderer still answer 404.
  it("answers an unknown form with the not found screen, kept out of search indexes", async () => {
    const v = new Visitor(inject("baseUrl"));
    const missing = await v.get("/f/no-such-form");
    expect(missing.status).toBe(200);
    expect(textOf(missing.html)).toContain("No encontramos este formulario");
    expect(missing.html).toMatch(/<meta name="robots" content="noindex/);

    const placeholder = await v.get("/f/__placeholder__");
    expect(textOf(placeholder.html)).toContain("No encontramos este formulario");

    const outside = await v.get("/no-such-path");
    expect(outside.status).toBe(404);
  });
});
