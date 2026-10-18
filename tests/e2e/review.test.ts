import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PLAN_TIME_ZONE, addDays, todayIn } from "@/modules/review/application";
import { createPool } from "@/shared/infrastructure/postgres/pool";
import { readStoredZip } from "../fakes/zip";
import { seedAdminSession } from "../support/admin-session";
import { photos, submitReference } from "./fill";
import { textOf } from "./http";
import { publishReferenceForm } from "./publish";
import { Staff } from "./staff";

// Review over HTTP without script, against the built app: the owner opens a story, corrects,
// chooses, ticks, plans, publishes, exports and deletes, plus the main failure paths.
// See specs/use-cases/review-submissions.md, curate-submission.md and specs/ui-ux/manager.md,
// "Routes". Synthetic data only.

const pool = createPool(inject("databaseUrl"), { max: 2 });
const base = inject("baseUrl");
let staff: Staff;

beforeAll(async () => {
  staff = new Staff(base, await seedAdminSession(pool, { email: "owner@example.com" }));
});
afterAll(async () => {
  await pool.end();
});

const STORY = "Una historia inventada para pruebas automáticas.";
const CORRECTED = "Una historia inventada, corregida para pruebas.";
const PHOTO_FIELD_SLUG = "sube-hasta-10-fotos-sin-editar-del-bebe";

async function count(sql: string, args: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(sql, args);
  return rows[0]?.n ?? 0;
}

const audits = (action: string, targetId: string) =>
  count("select count(*)::int as n from audit_log where action = $1 and target_id = $2", [
    action,
    targetId,
  ]);

const storyPath = (formId: string, reference: string) =>
  `/admin/forms/${formId}/submissions/${reference}`;

async function answersText(submissionId: string): Promise<string> {
  const { rows } = await pool.query<{ answers: string }>(
    "select answers::text as answers from submission where id = $1",
    [submissionId],
  );
  return rows[0]?.answers ?? "";
}

async function senderMedia(submissionId: string): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    "select id from media where submission_id = $1 and field_key <> 'staff-photos' order by position",
    [submissionId],
  );
  return rows.map((r) => r.id);
}

async function jpeg(): Promise<File> {
  const [file] = await photos(1);
  if (file === undefined) throw new Error("no synthetic photo");
  return file;
}

async function plannedOn(submissionId: string): Promise<string | null> {
  const { rows } = await pool.query<{ planned_on: string | null }>(
    "select planned_on::text as planned_on from story where submission_id = $1",
    [submissionId],
  );
  return rows[0]?.planned_on ?? null;
}

describe("review without script", () => {
  it("reviews, corrects, chooses, plans, publishes and exports a story", async () => {
    const { formId, slug } = await publishReferenceForm(pool, { usePostPlan: true });
    const { reference, submissionId } = await submitReference(pool, slug, 2, base);
    expect(reference).toBe("HP-0001");
    const path = storyPath(formId, reference);

    const list = await staff.get(`/admin/forms/${formId}`);
    expect(list.status).toBe(200);
    expect(textOf(list.html)).toContain("HP-0001");
    expect(textOf(list.html)).toContain("1 respuesta");

    const opened = await staff.get(path);
    expect(opened.status).toBe(200);
    expect(textOf(opened.html)).toContain(STORY);
    const status = await pool.query<{ status: string }>(
      "select status from submission where id = $1",
      [submissionId],
    );
    expect(status.rows[0]?.status).toBe("viewed");
    expect(await audits("submission_viewed", submissionId)).toBe(1);
    const original = await answersText(submissionId);

    const corrected = await staff.post(`${path}/correction`, {
      field: "story",
      text: CORRECTED,
      back: "",
    });
    expect(corrected.status).toBe(303);
    expect(corrected.location).toBe(`${path}?done=saved`);
    const afterCorrection = textOf((await staff.get(corrected.location ?? path)).html);
    expect(afterCorrection).toContain("Editada");
    expect(afterCorrection).toContain("Corregida por owner@example.com");
    const compare = await staff.get(`${path}?compare=story`);
    expect(compare.html).toContain("<ins");
    expect(compare.html).toContain("<del");

    const [first] = await senderMedia(submissionId);
    if (first === undefined) throw new Error("no media row");
    const chosen = await staff.post(`${path}/choice`, { media: first, chosen: "1", back: "" });
    expect(chosen.status).toBe(303);
    expect(chosen.location).toMatch(/#photos$/);
    const ticked = await staff.post(`${path}/check`, {
      check: "photos_edited",
      value: "1",
      back: "",
    });
    expect(ticked.status).toBe(303);
    const checked = await pool.query<{ text_checked_at: Date | null }>(
      "select text_checked_at from story where submission_id = $1",
      [submissionId],
    );
    expect(checked.rows[0]?.text_checked_at).toBeInstanceOf(Date);

    const thumb = await staff.download(`${path}/media/${first}?view=thumb`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/webp");
    const full = await staff.download(`${path}/media/${first}?view=full`);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("image/jpeg");
    expect(await audits("photo_viewed", submissionId)).toBe(1);

    const tomorrow = addDays(todayIn(PLAN_TIME_ZONE, new Date()), 1);
    const planned = await staff.post(`${path}/plan`, { date: tomorrow, back: "" });
    expect(planned.status).toBe(303);
    const week = await staff.get(`/admin/plan?week=${tomorrow}`);
    expect(textOf(week.html)).toContain("HP-0001");
    expect(textOf(week.html)).toContain("Lista");

    const postUrl = "https://www.instagram.com/p/prueba-0001/";
    const published = await staff.post(`${path}/status`, {
      intent: "publish",
      post_url: postUrl,
      back: "",
    });
    expect(published.status).toBe(303);
    expect(published.location).toContain("done=published");
    const publishedWeek = await staff.get(`/admin/plan?week=${tomorrow}`);
    expect(textOf(publishedWeek.html)).toContain("Publicada");
    expect(publishedWeek.html).toContain(postUrl);

    const zip = await staff.download(`${path}/photos.zip?set=chosen`);
    expect(zip.status).toBe(200);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    expect(readStoredZip(zip.bytes).map((entry) => entry.name)).toEqual([
      `HP-0001/01-${PHOTO_FIELD_SLUG}.jpg`,
    ]);

    const csv = await staff.download(`/admin/forms/${formId}/export`, {
      versions: "all",
      text: "both",
      paths: "1",
    });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toMatch(/^text\/csv/);
    expect([...csv.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder().decode(csv.bytes.slice(3)).split("\r\n");
    expect(lines[0]).toMatch(
      /^Referencia,Estado,Recibida \(UTC\),Versión,Idioma,Fecha planificada,Enlace de la publicación/,
    );
    const row = lines.find((line) => line.startsWith("HP-0001,")) ?? "";
    expect(row).toContain(STORY);
    expect(row).toContain(CORRECTED);
    expect(await audits("submissions_exported", formId)).toBe(1);

    expect(await answersText(submissionId)).toBe(original);
  });

  it("adds staff photos only after the sender is confirmed", async () => {
    const { formId, slug } = await publishReferenceForm(pool, { usePostPlan: true });
    const { reference, submissionId } = await submitReference(pool, slug, 1, base);
    const path = storyPath(formId, reference);
    const mediaRows = () =>
      count("select count(*)::int as n from media where submission_id = $1", [submissionId]);
    const before = await mediaRows();

    const unconfirmed = await staff.post(`${path}/photos`, { source: "whatsapp", back: "" }, [
      { field: "files", file: await jpeg() },
    ]);
    expect(unconfirmed.status).toBe(303);
    expect(unconfirmed.location).toBe(`${path}?error=not_confirmed#photos`);
    expect(await mediaRows()).toBe(before);

    const added = await staff.post(
      `${path}/photos`,
      { source: "whatsapp", confirmed: "1", back: "" },
      [{ field: "files", file: await jpeg() }],
    );
    expect(added.status).toBe(303);
    expect(added.location).toBe(`${path}?done=photos_added&n=1#photos`);
    const staffMedia = await pool.query<{ id: string; durable_key: string }>(
      "select id, durable_key from media where submission_id = $1 and field_key = 'staff-photos'",
      [submissionId],
    );
    expect(staffMedia.rows).toHaveLength(1);
    expect(staffMedia.rows[0]?.durable_key).toMatch(
      /^forms\/historia-prematuro-[a-z0-9]+\/HP-0001\/staff-01-[0-9a-f]{8}\.jpg$/,
    );
    expect(
      await count("select count(*)::int as n from staff_photo where id = $1", [
        staffMedia.rows[0]?.id,
      ]),
    ).toBe(1);
    const page = textOf((await staff.get(path)).html);
    expect(page).toContain("Agregadas por el equipo");
    expect(page).toContain("Desde WhatsApp");
  });

  it("refuses a tampered over-long correction and keeps the original", async () => {
    const { formId, slug } = await publishReferenceForm(pool, { usePostPlan: true });
    const { reference, submissionId } = await submitReference(pool, slug, 1, base);
    const path = storyPath(formId, reference);
    const original = await answersText(submissionId);

    const refused = await staff.post(`${path}/correction`, {
      field: "story",
      text: "a".repeat(20_001),
      back: "",
    });
    expect(refused.status).toBe(303);
    expect(refused.location).toBe(`${path}?edit=story&error=correction_too_long&n=20000`);
    expect(
      await count("select count(*)::int as n from submission_edit where submission_id = $1", [
        submissionId,
      ]),
    ).toBe(0);
    expect(await answersText(submissionId)).toBe(original);
  });

  it("asks before taking a planned day, then moves the other story", async () => {
    const { formId, slug } = await publishReferenceForm(pool, { usePostPlan: true });
    const one = await submitReference(pool, slug, 1, base);
    const two = await submitReference(pool, slug, 1, base);
    expect([one.reference, two.reference]).toEqual(["HP-0001", "HP-0002"]);
    // A day no other case of this run plans.
    const day = addDays(todayIn(PLAN_TIME_ZONE, new Date()), 20);

    const first = await staff.post(`${storyPath(formId, one.reference)}/plan`, {
      date: day,
      back: "",
    });
    expect(first.status).toBe(303);
    expect(await plannedOn(one.submissionId)).toBe(day);

    const secondPath = storyPath(formId, two.reference);
    const conflict = await staff.post(`${secondPath}/plan`, { date: day, back: "" });
    expect(conflict.status).toBe(303);
    expect(conflict.location).toContain(`conflict_date=${day}`);
    expect(conflict.location).toContain("conflict_ref=HP-0001");
    const asked = await staff.get(conflict.location ?? secondPath);
    expect(textOf(asked.html)).toContain(`HP-0001 ya está planificada para el ${day}.`);

    const moved = await staff.post(`${secondPath}/plan`, {
      date: day,
      resolution: "move",
      back: "",
    });
    expect(moved.status).toBe(303);
    expect(await plannedOn(one.submissionId)).toBeNull();
    expect(await plannedOn(two.submissionId)).toBe(day);
  });

  it("answers an unknown story with the not-found body", async () => {
    const { formId } = await publishReferenceForm(pool, { usePostPlan: true });
    const missing = await staff.get(storyPath(formId, "HP-9999"));
    expect(missing.status).toBe(200);
    expect(textOf(missing.html)).toContain("Respuesta no encontrada");
    expect(missing.html).toContain(`href="/admin/forms/${formId}"`);
  });

  it("sends a post without a session to sign-in and a stale token to the out-of-date page", async () => {
    const { formId, slug } = await publishReferenceForm(pool, { usePostPlan: true });
    const { reference } = await submitReference(pool, slug, 1, base);
    const path = storyPath(formId, reference);
    const fields = { field: "story", text: CORRECTED, back: "" };

    const anonymous = await staff.post(`${path}/correction`, fields, [], { anonymous: true });
    expect(anonymous.status).toBe(302);
    expect(new URL(anonymous.location ?? "", base).pathname).toBe("/admin/auth/signin");
    expect(new URL(anonymous.location ?? "", base).searchParams.get("returnTo")).toBe(path);

    const stale = await staff.post(`${path}/correction`, fields, [], { csrf: "not-the-token" });
    expect(stale.status).toBe(403);
    expect(textOf(stale.html)).toContain("Esta página estaba desactualizada");
  });

  it("deletes a story after its reference is typed, with every file", async () => {
    const { formId, slug } = await publishReferenceForm(pool, { usePostPlan: true });
    const { reference, submissionId } = await submitReference(pool, slug, 2, base);
    const path = storyPath(formId, reference);
    const added = await staff.post(
      `${path}/photos`,
      { source: "whatsapp", confirmed: "1", back: "" },
      [{ field: "files", file: await jpeg() }],
    );
    expect(added.location).toContain("done=photos_added");
    const checked = await staff.post(`${path}/check`, {
      check: "text_checked",
      value: "1",
      back: "",
    });
    expect(checked.status).toBe(303);
    const { rows: media } = await pool.query<{ id: string }>(
      "select id from media where submission_id = $1",
      [submissionId],
    );
    expect(media).toHaveLength(3);
    const rowsOf = async () => ({
      submission: await count("select count(*)::int as n from submission where id = $1", [
        submissionId,
      ]),
      story: await count("select count(*)::int as n from story where submission_id = $1", [
        submissionId,
      ]),
      staffPhoto: await count(
        "select count(*)::int as n from staff_photo where submission_id = $1",
        [submissionId],
      ),
    });
    expect(await rowsOf()).toEqual({ submission: 1, story: 1, staffPhoto: 1 });

    const mismatch = await staff.post(`${path}/delete`, { typed: "HP-0002", back: "" });
    expect(mismatch.status).toBe(303);
    expect(mismatch.location).toContain("action=delete&error=reference_mismatch");
    expect((await rowsOf()).submission).toBe(1);

    const deleted = await staff.post(`${path}/delete`, { typed: "hp-0001", back: "" });
    expect(deleted.status).toBe(303);
    expect(deleted.location).toBe(`/admin/forms/${formId}?deleted=HP-0001`);
    expect(await rowsOf()).toEqual({ submission: 0, story: 0, staffPhoto: 0 });
    const deleteJobs = await pool.query<{ media_id: string }>(
      `select payload->>'mediaId' as media_id from job
        where type = 'media.delete' and payload->>'mediaId' = any($1::text[])`,
      [media.map((m) => m.id)],
    );
    expect(deleteJobs.rows.map((j) => j.media_id).sort()).toEqual(media.map((m) => m.id).sort());
    expect(await audits("submission_deleted", submissionId)).toBe(1);
  });
});
