import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { startApp } from "../support/app-server";

/** Starts database-holder.ts under tsx and resolves with the URL of the database it created. */
async function holdTestDatabase(): Promise<{ url: string; drop(): Promise<void> }> {
  const child: ChildProcess = spawn(
    process.execPath,
    ["--import", "tsx", "tests/browser/database-holder.ts"],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  const drop = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin?.end();
      await exited;
    }
  };
  const url = await new Promise<string | null>((resolve) => {
    if (child.stdout === null) {
      resolve(null);
      return;
    }
    const lines = createInterface({ input: child.stdout });
    lines.once("line", (line) => {
      lines.close();
      resolve(line.trim());
    });
    void exited.then(() => {
      resolve(null);
    });
  });
  if (url === null || url === "") {
    await drop();
    throw new Error("the test database holder exited before it printed a URL");
  }
  return { url, drop };
}

/**
 * Creates a throwaway database (`createTestDatabase`, in its own process) and starts the built
 * app on it on port 3299 (`startApp`); the test workers start afterwards and inherit
 * `E2E_DATABASE_URL`. The returned teardown stops the app and drops the database. See ADR 0024.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const db = await holdTestDatabase();
  let app: Awaited<ReturnType<typeof startApp>>;
  try {
    app = await startApp({ port: 3299, databaseUrl: db.url });
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
