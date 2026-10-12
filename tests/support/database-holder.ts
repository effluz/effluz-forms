import { createTestDatabase } from "./test-database";

/*
 * Holds an end-to-end run's throwaway database in its own process, started by
 * `holdTestDatabase` (held-database.ts) through tsx. A process of its own outlives an interrupted
 * test runner long enough to drop the database, and under Playwright it is also needed because
 * Playwright compiles TypeScript to CommonJS while the migrations module finds its folders
 * through `import.meta`. Prints the database URL as one line, then drops the database when stdin
 * closes (the runner ended, however it ended), on SIGTERM, or on the SIGINT a Ctrl+C sends to
 * the whole foreground process group. The handlers are installed before the database exists, so
 * an interrupt during creation or migration still ends in a drop.
 */
async function main(): Promise<void> {
  const creating = createTestDatabase();
  let dropping = false;
  const finish = (): void => {
    if (dropping) return;
    dropping = true;
    creating
      .then((db) => db.drop())
      .then(
        () => process.exit(0),
        (error: unknown) => {
          process.stderr.write(`could not drop the test database: ${String(error)}\n`);
          process.exit(1);
        },
      );
  };
  process.stdin.on("end", finish);
  process.on("SIGTERM", finish);
  process.on("SIGINT", finish);
  process.stdin.resume();
  const db = await creating;
  process.stdout.write(`${db.url}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`could not create the test database: ${String(error)}\n`);
  process.exit(1);
});
