/**
 * Health check. Pure: the probe supplies the facts, this decides the status.
 * See specs/system/deployment.md, "Health endpoint".
 */
export interface HealthProbe {
  databaseReachable(): Promise<boolean>;
  /** Seconds since the newest worker heartbeat, or null when none was ever written. */
  heartbeatAgeSeconds(): Promise<number | null>;
  deadJobs(): Promise<number>;
  stagingWritable(): Promise<boolean>;
}

export interface HealthReport {
  status: "ok" | "degraded";
  version: string;
  database: boolean;
  workerHeartbeatSeconds: number | null;
  deadJobs: number;
  stagingWritable: boolean;
}

/** A worker heartbeat older than this means the worker is down. */
export const HEARTBEAT_STALE_SECONDS = 300;

/** A probe that throws counts as its failure value, so the report itself never throws. */
async function settle<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

/**
 * Degraded when the database is unreachable or the worker heartbeat is
 * missing or older than HEARTBEAT_STALE_SECONDS. Dead jobs and the staging
 * directory are reported but never degrade the status.
 */
export async function checkHealth(probe: HealthProbe, version: string): Promise<HealthReport> {
  const [database, workerHeartbeatSeconds, deadJobs, stagingWritable] = await Promise.all([
    settle(() => probe.databaseReachable(), false),
    settle(() => probe.heartbeatAgeSeconds(), null),
    settle(() => probe.deadJobs(), 0),
    settle(() => probe.stagingWritable(), false),
  ]);
  const heartbeatFresh =
    workerHeartbeatSeconds !== null && workerHeartbeatSeconds <= HEARTBEAT_STALE_SECONDS;
  return {
    status: database && heartbeatFresh ? "ok" : "degraded",
    version,
    database,
    workerHeartbeatSeconds,
    deadJobs,
    stagingWritable,
  };
}
