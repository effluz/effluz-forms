import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { settlesWithin } from "./app-server";

/**
 * The throwaway database tests/browser/global-setup.ts holds for the browser run, from
 * `E2E_DATABASE_URL`. Throws when it is unset or blank: pg would fall back to the PG*
 * environment, which may name a database that is not disposable.
 */
export function browserDatabaseUrl(): string {
  const url = process.env["E2E_DATABASE_URL"];
  if (url === undefined || url === "")
    throw new Error("E2E_DATABASE_URL is unset: run the browser suite through its global setup");
  return url;
}

/** How long `drop()` waits for the holder to drop the database and exit. */
const DROP_TIMEOUT_MS = 30_000;

/**
 * Starts database-holder.ts under tsx and resolves with the URL of the throwaway database it
 * created. `drop()` closes the holder's stdin, which drops the database, and waits for the holder
 * to exit; past `DROP_TIMEOUT_MS` it kills the holder and fails, since the database may then be
 * left behind. The holder also drops the database when this process dies, because its stdin
 * closes then. See specs/system/database.md, "Local development".
 */
export async function holdTestDatabase(): Promise<{ url: string; drop(): Promise<void> }> {
  const child: ChildProcess = spawn(
    process.execPath,
    ["--import", "tsx", "tests/support/database-holder.ts"],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  const drop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.stdin?.end();
    if (await settlesWithin(exited, DROP_TIMEOUT_MS)) return;
    child.kill("SIGKILL");
    await exited;
    throw new Error(
      `the test database holder did not exit within ${String(DROP_TIMEOUT_MS)} ms; an effluz_test_* database may be left behind`,
    );
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
