import { BROWSER_E2E_PORT, startApp } from "../support/app-server";
import { holdTestDatabase } from "../support/held-database";

/**
 * Creates a throwaway database (`holdTestDatabase`, in its own process) and starts the built app
 * on it on `BROWSER_E2E_PORT` (`startApp`); the test workers start afterwards and inherit
 * `E2E_DATABASE_URL`. The returned teardown stops the app and drops the database. See ADR 0024.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const db = await holdTestDatabase();
  let app: Awaited<ReturnType<typeof startApp>>;
  try {
    app = await startApp({ port: BROWSER_E2E_PORT, databaseUrl: db.url });
  } catch (e) {
    await db.drop();
    throw e;
  }
  process.env["E2E_DATABASE_URL"] = db.url;
  return async () => {
    try {
      await app.stop();
    } finally {
      await db.drop();
    }
  };
}
