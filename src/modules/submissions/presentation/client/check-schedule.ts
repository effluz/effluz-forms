/*
 * When blur checks leave (`POST /f/<slug>/check`): at once on blur, after a pause in typing
 * once a field shows an error, and not at all for a while after the route said 429. See
 * specs/ui-ux/renderer.md, "Validation and errors".
 */

/** The pause in typing before a field that shows an error is checked again. */
export const CHECK_DEBOUNCE_MS = 300;
/** How long nothing is sent after a 429. */
export const RATE_LIMIT_PAUSE_MS = 10_000;

export interface CheckScheduler {
  /** Typing in a field that shows an error: runs once typing pauses. */
  debounce: (key: string, run: () => void) => void;
  /** A blur: runs now, replacing the field's check still waiting. */
  now: (key: string, run: () => void) => void;
  /** The route answered 429: nothing leaves for a while, waiting checks included. */
  rateLimited: () => void;
  /** A new server render: waiting checks are forgotten. */
  clear: () => void;
}

export function createCheckScheduler(): CheckScheduler {
  const waiting = new Map<string, ReturnType<typeof setTimeout>>();
  let pausedUntil = 0;
  const paused = (): boolean => Date.now() < pausedUntil;
  const cancel = (key: string): void => {
    const timer = waiting.get(key);
    if (timer !== undefined) clearTimeout(timer);
    waiting.delete(key);
  };
  return {
    debounce(key, run) {
      cancel(key);
      if (paused()) return;
      waiting.set(
        key,
        setTimeout(() => {
          waiting.delete(key);
          if (!paused()) run();
        }, CHECK_DEBOUNCE_MS),
      );
    },
    now(key, run) {
      cancel(key);
      if (!paused()) run();
    },
    rateLimited() {
      pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
    },
    clear() {
      for (const key of [...waiting.keys()]) cancel(key);
    },
  };
}
