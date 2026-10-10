/**
 * Resolves to `fallback` when `promise` has not settled within `ms`. The timer
 * is always cleared, so it never keeps the process or a test run alive.
 * A rejection of `promise` still rejects: callers decide how to handle failure.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(fallback);
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
