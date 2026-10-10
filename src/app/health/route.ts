import { access, constants } from "node:fs/promises";
import { connection } from "next/server";
import { getContainer } from "@/app/container";
import { checkHealth, type HealthProbe } from "@/shared/application/health";

/** Each probe catches its own failure, so one broken dependency cannot fail the route. */
function buildProbe(c: ReturnType<typeof getContainer>): HealthProbe {
  return {
    databaseReachable: async () => {
      try {
        await c.pool.query("select 1");
        return true;
      } catch {
        return false;
      }
    },
    heartbeatAgeSeconds: async () => {
      try {
        return await c.jobStore.heartbeatAgeSeconds();
      } catch {
        return null;
      }
    },
    deadJobs: async () => {
      try {
        return (await c.jobStore.counts()).dead;
      } catch {
        return 0;
      }
    },
    stagingWritable: async () => {
      try {
        await access(c.config.stagingDir, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** GET /health. Public and free of sensitive data. See specs/system/deployment.md, "Health endpoint". */
export async function GET(): Promise<Response> {
  // With Cache Components the `dynamic` segment config is not allowed. Opting into
  // request-time rendering keeps Next from prerendering this answer at build time.
  await connection();
  let version = "unknown";
  let report;
  try {
    const container = getContainer();
    version = container.config.appVersion;
    report = await checkHealth(buildProbe(container), version);
  } catch {
    // Invalid configuration or a failed build of the container: report degraded, never throw.
    report = {
      status: "degraded",
      version,
      database: false,
      workerHeartbeatSeconds: null,
      deadJobs: 0,
      stagingWritable: false,
    };
  }
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
