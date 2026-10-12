import { createTestDatabase } from "../support/test-database";

/*
 * Holds the browser run's throwaway database in its own process, started by global-setup.ts
 * through tsx: Playwright compiles TypeScript to CommonJS, and the migrations module finds its
 * folders through `import.meta`, which CommonJS cannot parse. Prints the database URL as one
 * line, then drops the database when stdin closes or on SIGTERM.
 */
async function main(): Promise<void> {
  const db = await createTestDatabase();
  let dropping = false;
  const finish = (): void => {
    if (dropping) return;
    dropping = true;
    db.drop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.stdin.on("end", finish);
  process.on("SIGTERM", finish);
  process.stdin.resume();
  process.stdout.write(`${db.url}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`could not create the test database: ${String(error)}\n`);
  process.exit(1);
});
