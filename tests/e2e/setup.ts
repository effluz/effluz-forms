import type { TestProject } from "vitest/node";
import { startApp } from "../support/app-server";
import { createTestDatabase } from "../support/test-database";

/**
 * Creates a throwaway database, starts the built app on it, hands both to the
 * tests and, afterwards, stops the app and drops the database.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const db = await createTestDatabase();
  let app: Awaited<ReturnType<typeof startApp>>;
  try {
    app = await startApp({ port: 3199, databaseUrl: db.url });
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
