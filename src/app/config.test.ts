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

/** The remote adapters production requires. */
const productionAdapters = {
  MEDIA_PROVIDER: "dropbox",
  DROPBOX_APP_KEY: "k",
  DROPBOX_APP_SECRET: "s",
  DROPBOX_REFRESH_TOKEN: "r",
  EMAIL_PROVIDER: "smtp2go",
  SMTP2GO_API_KEY: "api",
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
      ...productionAdapters,
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
  it("requires NODE_ENV and names it, so no entry point falls back to development", () => {
    const env = { ...base };
    delete env.NODE_ENV;
    expect(() => loadConfig(env)).toThrow("Invalid configuration: NODE_ENV");
    expect(() => loadConfig({ ...base, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
  it.each(["SMTP2GO_API_URL", "DROPBOX_API_URL", "DROPBOX_CONTENT_URL"])(
    "refuses a plain-http %s in production and names only the variable",
    (name) => {
      const prod: NodeJS.ProcessEnv = {
        ...base,
        ...productionAdapters,
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://forms.example.com",
      };
      const attempt = () => loadConfig({ ...prod, [name]: "http://relay.example.com" });
      expect(attempt).toThrow(`Invalid configuration: ${name} must be https in production`);
      expect(attempt).not.toThrow(/relay\.example/);
      expect(() => loadConfig({ ...base, [name]: "http://127.0.0.1:9999" })).not.toThrow();
    },
  );
  it("rejects an unknown SERVICE or LOG_LEVEL", () => {
    expect(() => loadConfig({ ...base, SERVICE: "cron" })).toThrow(/SERVICE/);
    expect(() => loadConfig({ ...base, LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });

  describe("notificationAllowedDomains", () => {
    const env = { ...base, GOOGLE_ALLOWED_HOSTED_DOMAIN: "effluz.com" };

    it("puts the hosted domain first, then the cleaned partner list", () => {
      const c = loadConfig({
        ...env,
        NOTIFICATION_ALLOWED_DOMAINS: "Partner.Example, other.example",
      });
      expect(c.notificationAllowedDomains).toEqual([
        "effluz.com",
        "partner.example",
        "other.example",
      ]);
    });
    it("is just the hosted domain when the variable is empty or absent", () => {
      expect(
        loadConfig({ ...env, NOTIFICATION_ALLOWED_DOMAINS: "" }).notificationAllowedDomains,
      ).toEqual(["effluz.com"]);
      expect(loadConfig(env).notificationAllowedDomains).toEqual(["effluz.com"]);
    });
    it.each([
      "partner",
      "a.example.com/x",
      "@partner.example",
      "partner..example",
      "par ty.example",
    ])(
      "fails to load on the malformed entry %j, naming the variable and not the value",
      (entry) => {
        const attempt = () =>
          loadConfig({ ...env, NOTIFICATION_ALLOWED_DOMAINS: `ok.example,${entry}` });
        expect(attempt).toThrow(/NOTIFICATION_ALLOWED_DOMAINS/);
        expect(attempt).not.toThrow(entry);
      },
    );
    it("accepts a list of well-formed domains with surrounding spaces and capitals", () => {
      const c = loadConfig({
        ...env,
        NOTIFICATION_ALLOWED_DOMAINS: " Mail.Partner-One.example , two.example ",
      });
      expect(c.notificationAllowedDomains).toEqual([
        "effluz.com",
        "mail.partner-one.example",
        "two.example",
      ]);
    });
    it("drops empty entries and duplicates, including the hosted domain", () => {
      const c = loadConfig({
        ...env,
        GOOGLE_ALLOWED_HOSTED_DOMAIN: "Effluz.com",
        NOTIFICATION_ALLOWED_DOMAINS: " ,EFFLUZ.com,a.example,,A.example , ",
      });
      expect(c.notificationAllowedDomains).toEqual(["effluz.com", "a.example"]);
    });
  });
});

describe("media and email configuration", () => {
  it("defaults to local media and Mailpit outside production", () => {
    const c = loadConfig(base);
    expect(c.media).toEqual({ provider: "local", durableDir: "./data/durable" });
    expect(c.email).toEqual({
      provider: "mailpit",
      url: "http://127.0.0.1:8025",
      from: "Effluz Forms <forms@forms.effluz.com>",
      replyTo: "privacy@example.com",
    });
  });

  it("reads Dropbox and SMTP2GO, and names the missing variables", () => {
    const c = loadConfig({
      ...base,
      MEDIA_PROVIDER: "dropbox",
      DROPBOX_APP_KEY: "k",
      DROPBOX_APP_SECRET: "s",
      DROPBOX_REFRESH_TOKEN: "r",
      EMAIL_PROVIDER: "smtp2go",
      SMTP2GO_API_KEY: "api",
    });
    expect(c.media).toMatchObject({
      provider: "dropbox",
      appKey: "k",
      apiUrl: "https://api.dropboxapi.com",
    });
    expect(c.email).toMatchObject({
      provider: "smtp2go",
      apiKey: "api",
      apiUrl: "https://api.smtp2go.com/v3",
    });
    expect(() => loadConfig({ ...base, MEDIA_PROVIDER: "dropbox" })).toThrow(
      "Invalid configuration: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN",
    );
    expect(() => loadConfig({ ...base, EMAIL_PROVIDER: "smtp2go" })).toThrow(
      "Invalid configuration: SMTP2GO_API_KEY",
    );
  });

  it("refuses the local adapters in production", () => {
    const prod: NodeJS.ProcessEnv = {
      ...base,
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://forms.example.com",
    };
    expect(() => loadConfig(prod)).toThrow(/MEDIA_PROVIDER/);
    expect(() =>
      loadConfig({
        ...prod,
        MEDIA_PROVIDER: "dropbox",
        DROPBOX_APP_KEY: "k",
        DROPBOX_APP_SECRET: "s",
        DROPBOX_REFRESH_TOKEN: "r",
      }),
    ).toThrow(/EMAIL_PROVIDER/);
  });

  it("treats the blank values of .env.example as unset", () => {
    const c = loadConfig({
      ...base,
      DROPBOX_APP_KEY: "",
      DROPBOX_APP_SECRET: "",
      DROPBOX_REFRESH_TOKEN: "",
      SMTP2GO_API_KEY: "",
      EMAIL_REPLY_TO: "",
    });
    expect(c.media.provider).toBe("local");
    expect(c.email).toMatchObject({ provider: "mailpit", replyTo: "privacy@example.com" });
  });

  it("treats a whitespace-only optional secret as unset", () => {
    expect(() => loadConfig({ ...base, EMAIL_PROVIDER: "smtp2go", SMTP2GO_API_KEY: "  " })).toThrow(
      "Invalid configuration: SMTP2GO_API_KEY",
    );
    expect(loadConfig({ ...base, EMAIL_REPLY_TO: " \t" }).email.replyTo).toBe(
      "privacy@example.com",
    );
  });

  it("uses EMAIL_REPLY_TO when set and never puts a value in an error", () => {
    expect(loadConfig({ ...base, EMAIL_REPLY_TO: "help@example.com" }).email.replyTo).toBe(
      "help@example.com",
    );
    const attempt = () => loadConfig({ ...base, EMAIL_REPLY_TO: "not-an-address" });
    expect(attempt).toThrow("Invalid configuration: EMAIL_REPLY_TO");
    expect(attempt).not.toThrow("not-an-address");
  });
});
