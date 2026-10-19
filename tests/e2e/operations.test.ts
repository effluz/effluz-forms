import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createPool } from "@/shared/infrastructure/postgres/pool";
import { seedAdminSession } from "../support/admin-session";
import { submitReference } from "./fill";
import { textOf } from "./http";
import { publishReferenceForm } from "./publish";
import { Staff } from "./staff";

// Dead jobs over HTTP without script, against the built app: the flag in the list, the
// warning on the story with Try again, and the Operations page. No worker runs here, so the
// dead jobs are inserted as the job store leaves them. See specs/use-cases/operate-jobs.md and
// specs/ui-ux/manager.md, "Operations page". Synthetic data only.

const pool = createPool(inject("databaseUrl"), { max: 2 });
const base = inject("baseUrl");
let staff: Staff;

beforeAll(async () => {
  staff = new Staff(base, await seedAdminSession(pool, { email: "owner@example.com" }));
});
afterAll(async () => {
  await pool.end();
});

/** Inserts a job as the job store leaves one that ran out of attempts. */
async function deadJob(type: string, payload: Record<string, string>): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into job (id, type, payload, status, attempts, max_attempts, last_error, finished_at)
     values ($1, $2, $3, 'dead', 8, 8, 'synthetic failure', now())`,
    [id, type, JSON.stringify(payload)],
  );
  return id;
}

async function job(
  id: string,
): Promise<{ status: string; attempts: number; reason: string | null }> {
  const { rows } = await pool.query<{ status: string; attempts: number; reason: string | null }>(
    "select status, attempts, discard_reason as reason from job where id = $1",
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("no job row");
  return row;
}

async function storyMedia(submissionId: string): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    "select id from media where submission_id = $1 order by position",
    [submissionId],
  );
  return rows.map((r) => r.id);
}

describe("dead jobs without script", () => {
  it("flags a dead upload in the list and on the story, and Try again retries it", async () => {
    const { formId, slug } = await publishReferenceForm(pool, { usePostPlan: true });
    const { reference, submissionId } = await submitReference(pool, slug, 1, base);
    const [first] = await storyMedia(submissionId);
    if (first === undefined) throw new Error("no media row");
    const dead = await deadJob("media.upload", { mediaId: first });
    const path = `/admin/forms/${formId}/submissions/${reference}`;

    const list = await staff.get(`/admin/forms/${formId}`);
    expect(textOf(list.html)).toContain("Necesita atención");
    const page = textOf((await staff.get(path)).html);
    expect(page).toContain("Algo no terminó para esta historia");
    expect(page).toContain("Una foto o video no llegó a Dropbox.");

    const retried = await staff.post(`${path}/retry`, { back: "" });
    expect(retried.status).toBe(303);
    expect(retried.location).toContain("done=retried");
    expect(await job(dead)).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("Operations lists dead jobs, discards with a reason and retries all of a type", async () => {
    const { formId, slug } = await publishReferenceForm(pool, { usePostPlan: true });
    const { submissionId } = await submitReference(pool, slug, 2, base);
    const [first, second] = await storyMedia(submissionId);
    if (first === undefined || second === undefined) throw new Error("no media rows");
    const uploadOne = await deadJob("media.upload", { mediaId: first });
    const uploadTwo = await deadJob("media.upload", { mediaId: second });
    const cleanup = await deadJob("jobs.cleanup", {});

    const operations = await staff.get("/admin/operations");
    expect(operations.status).toBe(200);
    const text = textOf(operations.html);
    expect(text).toContain("media.upload");
    expect(text).toContain("jobs.cleanup");
    expect(operations.html).toContain(`href="/admin/forms/${formId}/submissions/HP-0001"`);
    expect(text).toContain("Reintentar todos los trabajos media.upload (2)");

    const blank = await staff.post("/admin/operations/discard", { job: uploadOne, reason: "" });
    expect(blank.status).toBe(303);
    expect(blank.location).toBe(`/admin/operations?error=reason_invalid&job=${uploadOne}`);
    expect((await job(uploadOne)).status).toBe("dead");

    const discarded = await staff.post("/admin/operations/discard", {
      job: uploadOne,
      reason: "Prueba",
    });
    expect(discarded.status).toBe(303);
    expect(await job(uploadOne)).toMatchObject({ status: "discarded", reason: "Prueba" });

    const all = await staff.post("/admin/operations/retry-type", { type: "media.upload" });
    expect(all.status).toBe(303);
    expect(all.location).toBe("/admin/operations?done=retried_all&n=1");
    expect((await job(uploadTwo)).status).toBe("pending");
    expect((await job(cleanup)).status).toBe("dead");
  });
});
