export interface SignInAttempt {
  id: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: Date;
}

export interface SignInAttemptStore {
  /** Autonomous write; the attempt expires 10 minutes after `createdAt`. */
  create(attempt: SignInAttempt): Promise<void>;
  /** Returns and deletes the attempt atomically; null if it is missing or expired at `now`. */
  consume(id: string, now: Date): Promise<SignInAttempt | null>;
}
