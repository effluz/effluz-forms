const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for a UUID in its canonical hyphenated form. Ids reach the adapters from
 * cookies unchecked, and Postgres rejects anything else in a `uuid` column, so
 * the adapters treat a non-UUID id as naming no row.
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
