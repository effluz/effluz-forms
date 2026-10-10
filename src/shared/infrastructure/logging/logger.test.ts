import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const l of chunk.toString().split("\n"))
        if (l) lines.push(JSON.parse(l) as Record<string, unknown>);
      cb();
    },
  });
  return { lines, stream };
}

describe("createLogger", () => {
  it("emits JSON with service, version, level and message", () => {
    const { lines, stream } = capture();
    createLogger({ service: "worker", level: "info", version: "1.2.3", destination: stream }).info(
      "started",
      { jobId: "j1" },
    );
    expect(lines[0]).toMatchObject({
      service: "worker",
      version: "1.2.3",
      level: "info",
      msg: "started",
      jobId: "j1",
    });
    expect(typeof lines[0]?.["time"]).toBe("number");
  });

  it("redacts personal data fields at three depths", () => {
    const { lines, stream } = capture();
    createLogger({ service: "app", level: "info", version: "x", destination: stream }).info(
      "submission",
      {
        submissionId: "s1",
        email: "ana@example.com",
        answers: { story: "secret" },
        nested: { name: "Ana" },
        deep: { inner: { email: "deep@example.com" } },
      },
    );
    const line = JSON.stringify(lines[0]);
    expect(line).toContain("s1");
    expect(line).not.toContain("ana@example.com");
    expect(line).not.toContain("secret");
    expect(line).not.toContain("Ana");
    expect(line).not.toContain("deep@example.com");
    expect(line).toContain("[Redacted]");
  });

  it("respects the level and child fields", () => {
    const { lines, stream } = capture();
    const log = createLogger({
      service: "app",
      level: "warn",
      version: "x",
      destination: stream,
    }).child({ requestId: "r1" });
    log.info("hidden");
    log.warn("shown");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ requestId: "r1", msg: "shown" });
  });
});
