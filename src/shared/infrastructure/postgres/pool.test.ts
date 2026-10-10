import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@/shared/application/ports/logger";
import { createPool, poolOptions } from "./pool";

const URL = "postgres://u:p@127.0.0.1:5432/db";

function fakeLogger(warn = vi.fn()): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn,
    error: vi.fn(),
    child: () => logger,
  };
  return logger;
}

describe("poolOptions", () => {
  it("defaults to a 30 second statement timeout and 10 connections", () => {
    const o = poolOptions(URL);
    expect(o.statement_timeout).toBe(30_000);
    expect(o.max).toBe(10);
    expect(o.application_name).toBe("effluz-forms");
    expect(o.connectionTimeoutMillis).toBe(5_000);
  });

  it("passes 0 through, leaving the server default to apply", () => {
    expect(poolOptions(URL, { statementTimeoutMs: 0 }).statement_timeout).toBe(0);
  });

  it("accepts a custom statement timeout and pool size", () => {
    const o = poolOptions(URL, { statementTimeoutMs: 5_000, max: 2 });
    expect(o.statement_timeout).toBe(5_000);
    expect(o.max).toBe(2);
  });
});

describe("createPool", () => {
  it("logs pool errors instead of crashing the process", async () => {
    const warn = vi.fn();
    const pool = createPool(URL, { logger: fakeLogger(warn) });
    pool.emit("error", new Error("terminating connection"));
    expect(warn).toHaveBeenCalledWith("postgres pool error", {
      message: "terminating connection",
    });
    await pool.end();
  });

  it("still handles pool errors without a logger", async () => {
    const pool = createPool(URL);
    expect(() => pool.emit("error", new Error("boom"))).not.toThrow();
    await pool.end();
  });
});
