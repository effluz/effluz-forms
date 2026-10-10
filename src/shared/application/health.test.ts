import { describe, expect, it } from "vitest";
import { checkHealth, HEARTBEAT_STALE_SECONDS, type HealthProbe } from "./health";

function probe(overrides: Partial<HealthProbe> = {}): HealthProbe {
  return {
    databaseReachable: () => Promise.resolve(true),
    heartbeatAgeSeconds: () => Promise.resolve(5),
    deadJobs: () => Promise.resolve(0),
    stagingWritable: () => Promise.resolve(true),
    ...overrides,
  };
}

describe("checkHealth", () => {
  it("reports ok with every probe value when all is well", async () => {
    expect(await checkHealth(probe(), "1.2.3")).toEqual({
      status: "ok",
      version: "1.2.3",
      database: true,
      workerHeartbeatSeconds: 5,
      deadJobs: 0,
      stagingWritable: true,
    });
  });

  it("degrades when the database is unreachable", async () => {
    const report = await checkHealth(
      probe({ databaseReachable: () => Promise.resolve(false) }),
      "v",
    );
    expect(report.status).toBe("degraded");
    expect(report.database).toBe(false);
  });

  it("stays ok at the stale threshold and degrades one second past it", async () => {
    const at = await checkHealth(
      probe({ heartbeatAgeSeconds: () => Promise.resolve(HEARTBEAT_STALE_SECONDS) }),
      "v",
    );
    expect(at.status).toBe("ok");
    const past = await checkHealth(probe({ heartbeatAgeSeconds: () => Promise.resolve(301) }), "v");
    expect(past.status).toBe("degraded");
    expect(past.workerHeartbeatSeconds).toBe(301);
  });

  it("degrades when no worker heartbeat was ever written", async () => {
    const report = await checkHealth(
      probe({ heartbeatAgeSeconds: () => Promise.resolve(null) }),
      "v",
    );
    expect(report.status).toBe("degraded");
    expect(report.workerHeartbeatSeconds).toBeNull();
  });

  it("does not degrade for dead jobs or an unwritable staging directory", async () => {
    const report = await checkHealth(
      probe({ deadJobs: () => Promise.resolve(5), stagingWritable: () => Promise.resolve(false) }),
      "v",
    );
    expect(report.status).toBe("ok");
    expect(report.deadJobs).toBe(5);
    expect(report.stagingWritable).toBe(false);
  });

  it("treats a throwing probe as false, null or zero without throwing", async () => {
    const boom = (): Promise<never> => Promise.reject(new Error("boom"));
    const report = await checkHealth(
      {
        databaseReachable: boom,
        heartbeatAgeSeconds: boom,
        deadJobs: boom,
        stagingWritable: boom,
      },
      "v",
    );
    expect(report).toEqual({
      status: "degraded",
      version: "v",
      database: false,
      workerHeartbeatSeconds: null,
      deadJobs: 0,
      stagingWritable: false,
    });
  });

  it("treats a probe that throws synchronously the same way", async () => {
    const report = await checkHealth(
      probe({
        databaseReachable: () => {
          throw new Error("sync");
        },
      }),
      "v",
    );
    expect(report.database).toBe(false);
    expect(report.status).toBe("degraded");
  });
});
