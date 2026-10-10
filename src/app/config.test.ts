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
      leaseSeconds: 90,
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
  it("refuses a plain-http GOOGLE_ISSUER in production and names only the variable", () => {
    const prod: NodeJS.ProcessEnv = {
      ...base,
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://forms.example.com",
    };
    expect(() => loadConfig({ ...prod, GOOGLE_ISSUER: "http://issuer.example.com" })).toThrow(
      /GOOGLE_ISSUER/,
    );
    expect(() => loadConfig({ ...prod, GOOGLE_ISSUER: "http://issuer.example.com" })).not.toThrow(
      /issuer\.example/,
    );
    expect(loadConfig({ ...base, GOOGLE_ISSUER: "http://127.0.0.1:9999" }).google.issuer).toBe(
      "http://127.0.0.1:9999",
    );
  });
  it("stores PUBLIC_BASE_URL as an origin without a trailing slash", () => {
    expect(loadConfig(base).publicBaseUrl).toBe("http://localhost:3000");
    expect(
      loadConfig({ ...base, PUBLIC_BASE_URL: "https://forms.example.com/" }).publicBaseUrl,
    ).toBe("https://forms.example.com");
  });
  it.each([
    ["a path", "https://forms.example.com/forms"],
    ["a query", "https://forms.example.com/?x=1"],
    ["an empty query", "https://forms.example.com/?"],
    ["a fragment", "https://forms.example.com/#top"],
  ])("rejects a PUBLIC_BASE_URL with %s and names only the variable", (_name, value) => {
    expect(() => loadConfig({ ...base, PUBLIC_BASE_URL: value })).toThrow(/PUBLIC_BASE_URL/);
    expect(() => loadConfig({ ...base, PUBLIC_BASE_URL: value })).not.toThrow(/forms\.example/);
  });
  it("rejects an empty APP_VERSION or SESSION_COOKIE_NAME and names it", () => {
    expect(() => loadConfig({ ...base, APP_VERSION: "" })).toThrow(/APP_VERSION/);
    expect(() => loadConfig({ ...base, SESSION_COOKIE_NAME: "" })).toThrow(/SESSION_COOKIE_NAME/);
  });
  it("rejects a worker lease below 30 seconds and names the variable", () => {
    expect(() => loadConfig({ ...base, WORKER_LEASE_SECONDS: "20" })).toThrow(
      /WORKER_LEASE_SECONDS/,
    );
    expect(loadConfig({ ...base, WORKER_LEASE_SECONDS: "30" }).worker.leaseSeconds).toBe(30);
  });
  it("rejects an unknown SERVICE or LOG_LEVEL", () => {
    expect(() => loadConfig({ ...base, SERVICE: "cron" })).toThrow(/SERVICE/);
    expect(() => loadConfig({ ...base, LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });
});
