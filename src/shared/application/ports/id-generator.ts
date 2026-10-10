/** Returns a random UUID v4 in lowercase. */
export interface IdGenerator {
  newId(): string;
}
