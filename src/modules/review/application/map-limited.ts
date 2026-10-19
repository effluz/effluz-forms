/**
 * Maps `items` through `fn` with at most `limit` calls in flight, keeping the input order in
 * the result. The first rejection rejects the whole map; calls already started still finish.
 */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  const lanes = Math.max(1, Math.min(Math.floor(limit), items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}
