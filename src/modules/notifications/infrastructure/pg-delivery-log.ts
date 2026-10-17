import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { DeliveryLog } from "../application";

/**
 * Postgres adapter for the email delivery log; see specs/system/email.md. The
 * first write for a key wins, so a retried job finds the earlier message id.
 */
export class PgDeliveryLog implements DeliveryLog {
  constructor(private readonly pool: Pool) {}

  async find(key: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ provider_message_id: string }>(
      "select provider_message_id from email_delivery where delivery_key = $1",
      [key],
    );
    return rows[0]?.provider_message_id ?? null;
  }

  async record(key: string, providerMessageId: string, at: Date): Promise<void> {
    await this.pool.query(
      `insert into email_delivery (id, delivery_key, provider_message_id, created_at, updated_at)
       values ($1, $2, $3, $4, $4)
       on conflict (delivery_key) do nothing`,
      [randomUUID(), key, providerMessageId, at],
    );
  }
}
