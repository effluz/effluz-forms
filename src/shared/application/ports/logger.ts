export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

/**
 * Structured logger. Fields must hold ids and lifecycle facts only; see
 * specs/system/observability.md, "Logging".
 */
export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Returns a logger that adds `fields` to every line it writes. */
  child(fields: LogFields): Logger;
}
