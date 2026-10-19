import type { Pool } from "pg";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import { isUuid } from "@/shared/infrastructure/uuid";
import type { StoryRepository, StoryRow } from "../application/ports/story-repository";
import type { IsoDate } from "../domain/days";

// Dates read as `YYYY-MM-DD` text: the driver would turn a `date` into a local-midnight Date.
const COLUMNS = `submission_id, form_id,
  to_char(planned_on, 'YYYY-MM-DD') as planned_on,
  to_char(published_on, 'YYYY-MM-DD') as published_on,
  chosen_media::text[] as chosen_media, photos_edited_for::text[] as photos_edited_for,
  photos_edited_by, photos_edited_at, text_checked_by, text_checked_at`;

interface Row {
  submission_id: string;
  form_id: string;
  planned_on: string | null;
  published_on: string | null;
  chosen_media: string[];
  photos_edited_for: string[] | null;
  photos_edited_by: string | null;
  photos_edited_at: Date | null;
  text_checked_by: string | null;
  text_checked_at: Date | null;
}

function toStory(row: Row): StoryRow {
  return {
    submissionId: row.submission_id,
    formId: row.form_id,
    plannedOn: row.planned_on,
    publishedOn: row.published_on,
    chosen: row.chosen_media,
    photosEditedFor: row.photos_edited_for,
    photosEditedBy: row.photos_edited_by,
    photosEditedAt: row.photos_edited_at,
    textCheckedBy: row.text_checked_by,
    textCheckedAt: row.text_checked_at,
  };
}

/** Postgres adapter for story rows; see specs/system/database.md and ADR 0028. */
export class PgStoryRepository implements StoryRepository {
  constructor(private readonly pool: Pool) {}

  async find(submissionId: string): Promise<StoryRow | null> {
    if (!isUuid(submissionId)) return null;
    const { rows } = await this.pool.query<Row>(
      `select ${COLUMNS} from story where submission_id = $1`,
      [submissionId],
    );
    const row = rows[0];
    return row ? toStory(row) : null;
  }

  async lockOrCreate(uow: UnitOfWork, submissionId: string, formId: string): Promise<StoryRow> {
    const { client } = txOf(uow);
    // `on conflict do nothing` keeps the transaction usable when the row exists.
    await client.query(
      `insert into story (submission_id, form_id) values ($1, $2)
       on conflict (submission_id) do nothing`,
      [submissionId, formId],
    );
    const { rows } = await client.query<Row>(
      `select ${COLUMNS} from story where submission_id = $1 for update`,
      [submissionId],
    );
    const row = rows[0];
    if (!row) throw new Error(`story of submission ${submissionId} vanished while locking`);
    return toStory(row);
  }

  async lockDay(uow: UnitOfWork, date: IsoDate): Promise<StoryRow | null> {
    const { client } = txOf(uow);
    await client.query("select pg_advisory_xact_lock(hashtext('story-plan:' || $1::text))", [date]);
    const { rows } = await client.query<Row>(
      `select ${COLUMNS} from story
        where planned_on = $1::date and published_on is null
        for update`,
      [date],
    );
    const row = rows[0];
    return row ? toStory(row) : null;
  }

  async save(uow: UnitOfWork, row: StoryRow, at: Date): Promise<void> {
    // `form_id` and `created_at` are set once, when the row is first written.
    await txOf(uow).client.query(
      `insert into story
         (submission_id, form_id, planned_on, published_on, chosen_media, photos_edited_for,
          photos_edited_by, photos_edited_at, text_checked_by, text_checked_at, created_at,
          updated_at)
       values ($1, $2, $3::date, $4::date, $5::uuid[], $6::uuid[], $7, $8, $9, $10, $11, $11)
       on conflict (submission_id) do update
         set planned_on = excluded.planned_on,
             published_on = excluded.published_on,
             chosen_media = excluded.chosen_media,
             photos_edited_for = excluded.photos_edited_for,
             photos_edited_by = excluded.photos_edited_by,
             photos_edited_at = excluded.photos_edited_at,
             text_checked_by = excluded.text_checked_by,
             text_checked_at = excluded.text_checked_at,
             updated_at = excluded.updated_at`,
      [
        row.submissionId,
        row.formId,
        row.plannedOn,
        row.publishedOn,
        row.chosen,
        row.photosEditedFor,
        row.photosEditedBy,
        row.photosEditedAt,
        row.textCheckedBy,
        row.textCheckedAt,
        at,
      ],
    );
  }
}
