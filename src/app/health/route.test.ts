import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: () => Promise.resolve(undefined) }));
vi.mock("@/app/container", () => ({ getContainer: vi.fn() }));

import { getContainer, type Container } from "@/app/container";
import { GET } from "./route";

let stagingDir: string;
beforeAll(async () => {
  stagingDir = await mkdtemp(path.join(os.tmpdir(), "health-route-"));
});
afterAll(async () => {
  await rm(stagingDir, { recursive: true, force: true });
});

const warn = vi.fn();

function fakeContainer(opts: {
  heartbeat?: number | null;
  query?: () => Promise<unknown>;
  dead?: number;
}): Container {
  return {
    config: { appVersion: "9.9.9", stagingDir },
    logger: { warn },
    pool: { query: opts.query ?? (() => Promise.resolve({ rows: [] })) },
    jobStore: {
      heartbeatAgeSeconds: () => Promise.resolve(opts.heartbeat === undefined ? 4 : opts.heartbeat),
      counts: () => Promise.resolve({ dead: opts.dead ?? 0 }),
    },
  } as unknown as Container;
}

beforeEach(() => {
  warn.mockReset();
  vi.mocked(getContainer).mockReset();
});

describe("GET /health", () => {
  it("returns 200 with the report when everything is healthy", async () => {
    vi.mocked(getContainer).mockReturnValue(fakeContainer({ dead: 2 }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      version: "9.9.9",
      database: true,
      workerHeartbeatSeconds: 4,
      deadJobs: 2,
      stagingWritable: true,
    });
  });

  it("never lets the response be cached", async () => {
    vi.mocked(getContainer).mockReturnValue(fakeContainer({}));
    expect((await GET()).headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 503 when the worker heartbeat is stale", async () => {
    vi.mocked(getContainer).mockReturnValue(fakeContainer({ heartbeat: 301 }));
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()) as { status: string }).toMatchObject({ status: "degraded" });
  });

  it("returns 503 with database false when the query rejects, logging only the error class", async () => {
    vi.mocked(getContainer).mockReturnValue(
      fakeContainer({ query: () => Promise.reject(new TypeError("password=hunter2")) }),
    );
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ database: false, status: "degraded" });
    expect(warn).toHaveBeenCalledWith("health probe failed", {
      probe: "database",
      error: "TypeError",
    });
  });

  it("returns 503 within the probe bound when the database never answers", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getContainer).mockReturnValue(
        fakeContainer({ query: () => new Promise<never>(() => undefined) }),
      );
      const pending = GET();
      await vi.advanceTimersByTimeAsync(3_000);
      const res = await pending;
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ database: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 503 with version unknown when the container cannot be built", async () => {
    vi.mocked(getContainer).mockImplementation(() => {
      throw new Error("Invalid configuration: DATABASE_URL");
    });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: "degraded",
      version: "unknown",
      database: false,
      workerHeartbeatSeconds: null,
      deadJobs: 0,
      stagingWritable: false,
    });
  });
});
