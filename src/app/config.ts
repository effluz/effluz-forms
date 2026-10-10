import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SERVICE: z.enum(["app", "worker"]).default("app"),
  APP_VERSION: z.string().default("dev"),
  PUBLIC_BASE_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  STAGING_DIR: z.string().min(1),
  PRIVACY_CONTACT_EMAIL: z.email(),
  SESSION_COOKIE_NAME: z.string().default("effluz_admin_session"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_ALLOWED_HOSTED_DOMAIN: z.string().min(1),
  GOOGLE_ISSUER: z.url().default("https://accounts.google.com"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(10).default(60),
});

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
}

/**
 * Validates the environment once, at process start. Pure: the caller passes
 * the environment in. Errors name variables, never their values.
 * See specs/architecture.md, "Configuration and secrets".
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new Error(`Invalid configuration: ${names}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === "production" && !e.PUBLIC_BASE_URL.startsWith("https://"))
    throw new Error("Invalid configuration: PUBLIC_BASE_URL must be https in production");
  return {
    nodeEnv: e.NODE_ENV,
    service: e.SERVICE,
    appVersion: e.APP_VERSION,
    publicBaseUrl: e.PUBLIC_BASE_URL,
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
  };
}
