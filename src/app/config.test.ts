import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const base: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  SERVICE: "app",
  PUBLIC_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://effluz:effluz@localhost:5432/effluz",
  STAGING_DIR: "/tmp/effluz-staging",
  PRIVACY_CONTACT_EMAIL: "privacy@example.com",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_ALLOWED_HOSTED_DOMAIN: "example.com",
};

describe("loadConfig", () => {
  it("parses a complete environment with defaults applied", () => {
    const c = loadConfig(base);
    expect(c.logLevel).toBe("info");
    expect(c.session).toEqual({
      cookieName: "effluz_admin_session",
      idleHours: 8,
      absoluteDays: 7,
      secure: false,
    });
    expect(c.google.issuer).toBe("https://accounts.google.com");
    expect(c.worker).toEqual({
      concurrency: 4,
      pollIntervalMs: 1000,
      leaseSeconds: 60,
    });
  });
  it("fails fast on a missing variable and names it without echoing values", () => {
    const env = { ...base };
    delete env.DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
    expect(() => loadConfig(env)).not.toThrow(/client-secret/);
  });
  it("requires https and secure cookies in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/PUBLIC_BASE_URL/);
    const c = loadConfig({
      ...base,
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://forms.example.com",
    });
    expect(c.session.secure).toBe(true);
  });
  it("rejects an unknown SERVICE or LOG_LEVEL", () => {
    expect(() => loadConfig({ ...base, SERVICE: "cron" })).toThrow(/SERVICE/);
    expect(() => loadConfig({ ...base, LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });
});
