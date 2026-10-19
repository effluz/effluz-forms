import { afterEach, describe, expect, it, vi } from "vitest";
import { browserDatabaseUrl } from "./held-database";

describe("browserDatabaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers the database the browser setup holds", () => {
    vi.stubEnv("E2E_DATABASE_URL", "postgres://effluz@127.0.0.1:5432/effluz_test_held");
    expect(browserDatabaseUrl()).toBe("postgres://effluz@127.0.0.1:5432/effluz_test_held");
  });

  it.each([
    ["unset", undefined],
    ["blank", ""],
  ])("throws when E2E_DATABASE_URL is %s, so pg never falls back to PG*", (_name, value) => {
    vi.stubEnv("E2E_DATABASE_URL", value);
    expect(() => browserDatabaseUrl()).toThrow("E2E_DATABASE_URL");
  });
});
