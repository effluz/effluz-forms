import { z } from "zod";

const envSchema = z.object({
  // Required: `next start` sets it but `tsx` does not, and every production guard keys on it.
  NODE_ENV: z.enum(["development", "test", "production"]),
  SERVICE: z.enum(["app", "worker"]).default("app"),
  APP_VERSION: z.string().min(1).default("dev"),
  PUBLIC_BASE_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  STAGING_DIR: z.string().min(1),
  PRIVACY_CONTACT_EMAIL: z.email(),
  SESSION_COOKIE_NAME: z.string().min(1).default("effluz_admin_session"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_ALLOWED_HOSTED_DOMAIN: z.string().min(1),
  NOTIFICATION_ALLOWED_DOMAINS: z.string().default(""),
  GOOGLE_ISSUER: z.url().default("https://accounts.google.com"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).default(90),
  MEDIA_PROVIDER: z.enum(["local", "dropbox"]).default("local"),
  MEDIA_DURABLE_DIR: z.string().min(1).default("./data/durable"),
  DROPBOX_APP_KEY: z.string().min(1).optional(),
  DROPBOX_APP_SECRET: z.string().min(1).optional(),
  DROPBOX_REFRESH_TOKEN: z.string().min(1).optional(),
  DROPBOX_API_URL: z.url().default("https://api.dropboxapi.com"),
  DROPBOX_CONTENT_URL: z.url().default("https://content.dropboxapi.com"),
  EMAIL_PROVIDER: z.enum(["mailpit", "smtp2go"]).default("mailpit"),
  SMTP2GO_API_KEY: z.string().min(1).optional(),
  SMTP2GO_API_URL: z.url().default("https://api.smtp2go.com/v3"),
  MAILPIT_URL: z.url().default("http://127.0.0.1:8025"),
  EMAIL_FROM: z.string().min(3).default("Effluz Forms <forms@forms.effluz.com>"),
  EMAIL_REPLY_TO: z.email().optional(),
  ALERT_EMAIL: z.email().optional(),
});

/** Variables `.env.example` ships blank; a blank or whitespace-only value means unset. */
const BLANK_MEANS_UNSET = [
  "DROPBOX_APP_KEY",
  "DROPBOX_APP_SECRET",
  "DROPBOX_REFRESH_TOKEN",
  "SMTP2GO_API_KEY",
  "EMAIL_REPLY_TO",
  "ALERT_EMAIL",
] as const;

/** URLs production refuses unless they are https. */
const HTTPS_IN_PRODUCTION = [
  "GOOGLE_ISSUER",
  "SMTP2GO_API_URL",
  "DROPBOX_API_URL",
  "DROPBOX_CONTENT_URL",
] as const;

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  service: "app" | "worker";
  appVersion: string;
  publicBaseUrl: string;
  databaseUrl: string;
  logLevel: "debug" | "info" | "warn" | "error";
  stagingDir: string;
  privacyContactEmail: string;
  session: {
    cookieName: string;
    idleHours: 8;
    absoluteDays: 7;
    secure: boolean;
  };
  google: {
    clientId: string;
    clientSecret: string;
    allowedHostedDomain: string;
    issuer: string;
  };
  worker: { concurrency: number; pollIntervalMs: number; leaseSeconds: number };
  /** Domains notification recipients may use; the Workspace hosted domain is always first. */
  notificationAllowedDomains: string[];
  /** Where durable media goes. Staging is always local (`stagingDir`). */
  media:
    | { provider: "local"; durableDir: string }
    | {
        provider: "dropbox";
        appKey: string;
        appSecret: string;
        refreshToken: string;
        apiUrl: string;
        contentUrl: string;
      };
  /** Where dead-job alerts go (ADR 0029); null outside production when unset. */
  alertEmail: string | null;
  /** How email leaves the system; `from` and `replyTo` apply to every message. */
  email:
    | { provider: "mailpit"; url: string; from: string; replyTo: string }
    | { provider: "smtp2go"; apiKey: string; apiUrl: string; from: string; replyTo: string };
}

/**
 * Validates the environment once, at process start. Pure: the caller passes
 * the environment in. Errors name variables, never their values.
 * See specs/architecture.md, "Configuration and secrets".
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) =>
        !(value?.trim() === "" && (BLANK_MEANS_UNSET as readonly string[]).includes(name)),
    ),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new Error(`Invalid configuration: ${names}`);
  }
  const e = parsed.data;
  const publicBaseUrl = originOf(e.PUBLIC_BASE_URL);
  if (publicBaseUrl === null) throw new Error("Invalid configuration: PUBLIC_BASE_URL");
  if (e.NODE_ENV === "production" && !publicBaseUrl.startsWith("https://"))
    throw new Error("Invalid configuration: PUBLIC_BASE_URL must be https in production");
  if (e.NODE_ENV === "production") {
    // These carry secrets or submitter addresses; plain http exists only for local fakes.
    for (const name of HTTPS_IN_PRODUCTION)
      if (!e[name].startsWith("https://"))
        throw new Error(`Invalid configuration: ${name} must be https in production`);
  }
  const notificationAllowedDomains = parseDomains(
    e.GOOGLE_ALLOWED_HOSTED_DOMAIN,
    e.NOTIFICATION_ALLOWED_DOMAINS,
  );
  if (notificationAllowedDomains === null)
    throw new Error("Invalid configuration: NOTIFICATION_ALLOWED_DOMAINS");
  if (e.NODE_ENV === "production" && e.MEDIA_PROVIDER === "local")
    throw new Error("Invalid configuration: MEDIA_PROVIDER must be dropbox in production");
  if (e.NODE_ENV === "production" && e.EMAIL_PROVIDER === "mailpit")
    throw new Error("Invalid configuration: EMAIL_PROVIDER must be smtp2go in production");
  if (e.NODE_ENV === "production" && e.ALERT_EMAIL === undefined)
    throw new Error("Invalid configuration: ALERT_EMAIL is required in production");
  const media = mediaConfig(e);
  const email = emailConfig(e);
  return {
    nodeEnv: e.NODE_ENV,
    service: e.SERVICE,
    appVersion: e.APP_VERSION,
    publicBaseUrl,
    databaseUrl: e.DATABASE_URL,
    logLevel: e.LOG_LEVEL,
    stagingDir: e.STAGING_DIR,
    privacyContactEmail: e.PRIVACY_CONTACT_EMAIL,
    session: {
      cookieName: e.SESSION_COOKIE_NAME,
      idleHours: 8,
      absoluteDays: 7,
      secure: e.NODE_ENV === "production",
    },
    google: {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      allowedHostedDomain: e.GOOGLE_ALLOWED_HOSTED_DOMAIN,
      issuer: e.GOOGLE_ISSUER,
    },
    worker: {
      concurrency: e.WORKER_CONCURRENCY,
      pollIntervalMs: e.WORKER_POLL_INTERVAL_MS,
      leaseSeconds: e.WORKER_LEASE_SECONDS,
    },
    notificationAllowedDomains,
    media,
    email,
    alertEmail: e.ALERT_EMAIL ?? null,
  };
}

type Env = z.infer<typeof envSchema>;

function mediaConfig(e: Env): AppConfig["media"] {
  if (e.MEDIA_PROVIDER === "local") return { provider: "local", durableDir: e.MEDIA_DURABLE_DIR };
  const {
    DROPBOX_APP_KEY: appKey,
    DROPBOX_APP_SECRET: appSecret,
    DROPBOX_REFRESH_TOKEN: token,
  } = e;
  if (appKey === undefined || appSecret === undefined || token === undefined) {
    const missing = [
      appKey === undefined ? "DROPBOX_APP_KEY" : null,
      appSecret === undefined ? "DROPBOX_APP_SECRET" : null,
      token === undefined ? "DROPBOX_REFRESH_TOKEN" : null,
    ].filter((n) => n !== null);
    throw new Error(`Invalid configuration: ${missing.join(", ")}`);
  }
  return {
    provider: "dropbox",
    appKey,
    appSecret,
    refreshToken: token,
    apiUrl: e.DROPBOX_API_URL,
    contentUrl: e.DROPBOX_CONTENT_URL,
  };
}

function emailConfig(e: Env): AppConfig["email"] {
  const replyTo = e.EMAIL_REPLY_TO ?? e.PRIVACY_CONTACT_EMAIL;
  if (e.EMAIL_PROVIDER === "mailpit")
    return { provider: "mailpit", url: e.MAILPIT_URL, from: e.EMAIL_FROM, replyTo };
  if (e.SMTP2GO_API_KEY === undefined) throw new Error("Invalid configuration: SMTP2GO_API_KEY");
  return {
    provider: "smtp2go",
    apiKey: e.SMTP2GO_API_KEY,
    apiUrl: e.SMTP2GO_API_URL,
    from: e.EMAIL_FROM,
    replyTo,
  };
}

/**
 * The origin of a bare base URL (no trailing slash), or null when the value has
 * a path, a query or a fragment, which every derived URL would silently lose.
 */
function originOf(value: string): string | null {
  const url = new URL(value);
  if (url.pathname !== "/" || /[?#]/.test(value)) return null;
  return url.origin;
}

const DOMAIN_SHAPE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Hosted domain first, then the comma-separated list: lowercased, trimmed,
 * deduplicated, no blanks. Null when a list entry is not shaped like a domain
 * (the hosted domain is Google's own value and is not shape-checked).
 */
function parseDomains(hosted: string, list: string): string[] | null {
  const partners = list
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d !== "");
  if (partners.some((d) => !DOMAIN_SHAPE.test(d))) return null;
  const all = [hosted.trim().toLowerCase(), ...partners];
  return [...new Set(all.filter((d) => d !== ""))];
}
