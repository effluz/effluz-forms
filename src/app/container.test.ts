import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { buildContainer, type Container } from "./container";

const config = loadConfig({
  NODE_ENV: "test",
  PUBLIC_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://user:pw@localhost:5432/none",
  STAGING_DIR: "./data/staging",
  PRIVACY_CONTACT_EMAIL: "privacy@example.com",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_ALLOWED_HOSTED_DOMAIN: "example.com",
});

describe("buildContainer", () => {
  it("wires the shared services from the config around the given pool", () => {
    const pool = {} as unknown as Pool;
    const c = buildContainer(config, { pool });
    expect(c.config).toBe(config);
    expect(c.pool).toBe(pool);
    expect(typeof c.uow.run).toBe("function");
    expect(typeof c.queue.enqueue).toBe("function");
    expect(c.jobStore.leaseSeconds).toBe(config.worker.leaseSeconds);
    expect(typeof c.logger.info).toBe("function");
  });

  it("lets overrides replace any part", () => {
    const pool = {} as unknown as Pool;
    const logger = { marker: true } as unknown as ReturnType<typeof buildContainer>["logger"];
    const c = buildContainer(config, { pool, logger });
    expect(c.logger).toBe(logger);
  });

  it("keeps the defaults when an override is explicitly undefined", () => {
    const pool = {} as unknown as Pool;
    // exactOptionalPropertyTypes forbids this in typed code; plain JS callers can still do it.
    const overrides = { pool, uow: undefined, queue: undefined, jobStore: undefined };
    const c = buildContainer(config, overrides as unknown as Partial<Container>);
    expect(typeof c.uow.run).toBe("function");
    expect(typeof c.queue.enqueue).toBe("function");
    expect(c.jobStore.leaseSeconds).toBe(config.worker.leaseSeconds);
  });
});
