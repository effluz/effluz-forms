import pino, { type Logger as PinoLogger } from "pino";
import type { LogFields, Logger, LogLevel } from "@/shared/application/ports/logger";

/**
 * Personal-data and secret field names. Defensive only: callers must not pass
 * these in the first place. See specs/system/observability.md, "Logging".
 */
export const REDACTED_FIELDS: readonly string[] = [
  "email",
  "name",
  "answers",
  "answer",
  "text",
  "body",
  "story",
  "fileName",
  "filename",
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "set-cookie",
];

// pino matches `*` as exactly one key, so each field is listed at the top level
// and up to three object levels down.
const REDACT_PATHS = REDACTED_FIELDS.flatMap((field) => [
  field,
  `*.${field}`,
  `*.*.${field}`,
  `*.*.*.${field}`,
]);

function wrap(p: PinoLogger): Logger {
  return {
    debug: (msg: string, fields?: LogFields) => {
      p.debug(fields ?? {}, msg);
    },
    info: (msg: string, fields?: LogFields) => {
      p.info(fields ?? {}, msg);
    },
    warn: (msg: string, fields?: LogFields) => {
      p.warn(fields ?? {}, msg);
    },
    error: (msg: string, fields?: LogFields) => {
      p.error(fields ?? {}, msg);
    },
    child: (fields: LogFields) => wrap(p.child(fields)),
  };
}

export function createLogger(opts: {
  service: "app" | "worker";
  level: LogLevel;
  version: string;
  destination?: NodeJS.WritableStream;
}): Logger {
  const p = pino(
    {
      level: opts.level,
      base: { service: opts.service, version: opts.version },
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
    },
    opts.destination ?? process.stdout,
  );
  return wrap(p);
}
