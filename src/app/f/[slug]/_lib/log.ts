import { getContainer } from "@/app/container";
import type { Logger } from "@/shared/application/ports/logger";
import { createLogger } from "@/shared/infrastructure/logging/logger";

let standAlone: Logger | undefined;

/**
 * The logger a renderer failure is written to: the container's, or a stand-alone one when the
 * container cannot be built (an invalid configuration), so that failure is logged too.
 */
export function rendererLogger(): Logger {
  try {
    return getContainer().logger;
  } catch {
    standAlone ??= createLogger({ service: "app", level: "warn", version: "unknown" });
    return standAlone;
  }
}
