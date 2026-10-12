import type { TestProject } from "vitest/node";
import { E2E_PORT, startApp } from "../support/app-server";
import { holdTestDatabase } from "../support/held-database";

/**
 * Creates a throwaway database, starts the built app on it, hands both to the tests and,
 * afterwards, stops the app and drops the database. The database lives in a holder process
 * (`holdTestDatabase`), so an interrupted run (Ctrl+C, SIGTERM, a killed runner) still drops it.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const db = await holdTestDatabase();
  let app: Awaited<ReturnType<typeof startApp>>;
  try {
    app = await startApp({ port: E2E_PORT, databaseUrl: db.url });
  } catch (e) {
    await db.drop();
    throw e;
  }
  project.provide("databaseUrl", db.url);
  project.provide("baseUrl", app.baseUrl);
  project.provide("stagingDir", app.stagingDir);
  return async () => {
    try {
      await app.stop();
    } finally {
      await db.drop();
    }
  };
}
