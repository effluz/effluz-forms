import { access, constants } from "node:fs/promises";
import { connection } from "next/server";
import { getContainer, type Container } from "@/app/container";
import { checkHealth, type HealthProbe, type HealthReport } from "@/shared/application/health";
import { withTimeout } from "./with-timeout";

/** No probe may hold the response longer than this; a timeout counts as that probe failing. */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * Runs one probe with a time bound. A failure or timeout yields `fallback` and
 * is logged with the probe name and error class only, never the message.
 */
async function guarded<T>(c: Container, name: string, run: () => Promise<T>, fallback: T) {
  try {
    return await withTimeout(run(), PROBE_TIMEOUT_MS, fallback);
  } catch (e) {
    c.logger.warn("health probe failed", {
      probe: name,
      error: e instanceof Error ? e.name : "Error",
    });
    return fallback;
  }
}

function buildProbe(c: Container): HealthProbe {
  return {
    databaseReachable: () =>
      guarded(
        c,
        "database",
        async () => {
          await c.pool.query("select 1");
          return true;
        },
        false,
      ),
    heartbeatAgeSeconds: () =>
      guarded(c, "heartbeat", () => c.jobStore.heartbeatAgeSeconds(), null),
    deadJobs: () => guarded(c, "deadJobs", async () => (await c.jobStore.counts()).dead, 0),
    stagingWritable: () =>
      guarded(
        c,
        "staging",
        async () => {
          await access(c.config.stagingDir, constants.W_OK);
          return true;
        },
        false,
      ),
  };
}

function degradedReport(version: string): HealthReport {
  return {
    status: "degraded",
    version,
    database: false,
    workerHeartbeatSeconds: null,
    deadJobs: 0,
    stagingWritable: false,
  };
}

/** GET /health. Public and free of sensitive data. See specs/system/deployment.md, "Health endpoint". */
export async function GET(): Promise<Response> {
  // With Cache Components the `dynamic` segment config is not allowed. Opting into
  // request-time rendering keeps Next from prerendering this answer at build time.
  await connection();
  let report: HealthReport;
  try {
    const container = getContainer();
    report = await checkHealth(buildProbe(container), container.config.appVersion);
  } catch {
    // Invalid configuration or a failed build of the container: report degraded, never throw.
    report = degradedReport("unknown");
  }
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
