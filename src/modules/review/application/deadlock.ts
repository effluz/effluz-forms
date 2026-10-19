/** Postgres SQLSTATE for "deadlock detected". */
const DEADLOCK = "40P01";
const MAX_CAUSE_DEPTH = 5;

function isDeadlock(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && e !== null && typeof e === "object"; depth++) {
    if ("code" in e && e.code === DEADLOCK) return true;
    e = "cause" in e ? e.cause : null;
  }
  return false;
}

/**
 * Runs a unit of work and, when Postgres picks it as a deadlock victim, runs it
 * once more: the other transaction has finished by then, so the second run gets
 * its locks. Review-internal; the module's entry point does not export it.
 */
export async function withDeadlockRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isDeadlock(error)) throw error;
    return run();
  }
}
