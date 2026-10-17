/** Remembers which messages were sent, so a retried job sends nothing twice. */
export interface DeliveryLog {
  /** The provider message id recorded under the key, or null. */
  find(key: string): Promise<string | null>;
  record(key: string, providerMessageId: string, at: Date): Promise<void>;
}
