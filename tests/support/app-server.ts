import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts the built app (`pnpm build` first) with `next start` on 127.0.0.1,
 * against `databaseUrl`, with local media under a fresh temporary root and
 * Mailpit as the email provider. Resolves once the renderer answers; `stop()`
 * ends the process and removes the root. Synthetic configuration only.
 * See specs/system/ci-cd.md, "As built".
 */
export async function startApp(input: {
  port: number;
  databaseUrl: string;
}): Promise<{ baseUrl: string; stagingDir: string; stop(): Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), "effluz-e2e-"));
  const stagingDir = path.join(root, "staging");
  const baseUrl = `http://127.0.0.1:${String(input.port)}`;
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(input.port), "-H", "127.0.0.1"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "test",
        SERVICE: "app",
        PUBLIC_BASE_URL: baseUrl,
        DATABASE_URL: input.databaseUrl,
        STAGING_DIR: stagingDir,
        MEDIA_PROVIDER: "local",
        MEDIA_DURABLE_DIR: path.join(root, "durable"),
        EMAIL_PROVIDER: "mailpit",
        PRIVACY_CONTACT_EMAIL: "privacy@example.com",
        GOOGLE_CLIENT_ID: "e2e-client",
        GOOGLE_CLIENT_SECRET: "e2e-secret",
        GOOGLE_ALLOWED_HOSTED_DOMAIN: "effluz.com",
        NOTIFICATION_ALLOWED_DOMAINS: "example.com",
        LOG_LEVEL: "warn",
      },
    },
  );
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  const running = (): boolean => child.exitCode === null && child.signalCode === null;

  const stop = async (): Promise<void> => {
    if (running()) {
      child.kill("SIGTERM");
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  };

  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (!running()) {
      await stop();
      throw new Error("next start exited before it answered");
    }
    try {
      const response = await fetch(`${baseUrl}/f/e2e-probe`, { redirect: "manual" });
      await response.arrayBuffer();
      break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`next start did not answer within ${String(READY_TIMEOUT_MS)} ms`);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  return { baseUrl, stagingDir, stop };
}
