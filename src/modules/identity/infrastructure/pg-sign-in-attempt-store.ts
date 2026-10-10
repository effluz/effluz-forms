import type { Pool } from "pg";
import type { SignInAttempt, SignInAttemptStore } from "../application/ports/sign-in-attempt-store";

interface AttemptRow {
  id: string;
  state: string;
  nonce: string;
  code_verifier: string;
  return_to: string;
  created_at: Date;
}

/** Postgres adapter for in-flight sign-in attempts; see specs/use-cases/sign-in.md. */
export class PgSignInAttemptStore implements SignInAttemptStore {
  constructor(private readonly pool: Pool) {}

  async create(attempt: SignInAttempt): Promise<void> {
    await this.pool.query(
      `insert into sign_in_attempt
         (id, state, nonce, code_verifier, return_to, created_at, updated_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $6, $6::timestamptz + interval '10 minutes')`,
      [
        attempt.id,
        attempt.state,
        attempt.nonce,
        attempt.codeVerifier,
        attempt.returnTo,
        attempt.createdAt,
      ],
    );
  }

  async consume(id: string, now: Date): Promise<SignInAttempt | null> {
    // One statement: the row is deleted whether or not it has expired, but only a
    // live one is returned, so an expired attempt cannot be replayed or linger.
    const { rows } = await this.pool.query<AttemptRow>(
      `with taken as (delete from sign_in_attempt where id = $1 returning *, expires_at > $2 as live)
       select id, state, nonce, code_verifier, return_to, created_at from taken where live`,
      [id, now],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      state: row.state,
      nonce: row.nonce,
      codeVerifier: row.code_verifier,
      returnTo: row.return_to,
      createdAt: row.created_at,
    };
  }
}
