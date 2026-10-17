import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_DEBOUNCE_MS, createCheckScheduler, RATE_LIMIT_PAUSE_MS } from "./check-schedule";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("blur check scheduling", () => {
  it("waits for a pause of about 300 ms in typing before checking a field that shows an error", () => {
    const scheduler = createCheckScheduler();
    const sent: string[] = [];
    for (const letter of "abcd") {
      scheduler.debounce("f_name", () => sent.push(`f_name:${letter}`));
      vi.advanceTimersByTime(100);
    }
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(CHECK_DEBOUNCE_MS);
    expect(sent).toEqual(["f_name:d"]);
    expect(CHECK_DEBOUNCE_MS).toBe(300);
  });

  it("debounces each field on its own", () => {
    const scheduler = createCheckScheduler();
    const sent: string[] = [];
    scheduler.debounce("f_name", () => sent.push("f_name"));
    scheduler.debounce("f_email", () => sent.push("f_email"));
    vi.advanceTimersByTime(CHECK_DEBOUNCE_MS);
    expect(sent.sort()).toEqual(["f_email", "f_name"]);
  });

  it("checks at once on blur, replacing a check still waiting for the same field", () => {
    const scheduler = createCheckScheduler();
    const sent: string[] = [];
    scheduler.debounce("f_name", () => sent.push("typed"));
    scheduler.now("f_name", () => sent.push("blur"));
    expect(sent).toEqual(["blur"]);
    vi.advanceTimersByTime(CHECK_DEBOUNCE_MS);
    expect(sent).toEqual(["blur"]);
  });

  it("sends nothing for 10 s after the server answered 429, then checks again", () => {
    const scheduler = createCheckScheduler();
    const sent: string[] = [];
    scheduler.debounce("f_name", () => sent.push("waiting"));
    scheduler.rateLimited();
    scheduler.now("f_email", () => sent.push("blur"));
    vi.advanceTimersByTime(CHECK_DEBOUNCE_MS);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(RATE_LIMIT_PAUSE_MS);
    scheduler.now("f_email", () => sent.push("after"));
    expect(sent).toEqual(["after"]);
    expect(RATE_LIMIT_PAUSE_MS).toBe(10_000);
  });

  it("forgets waiting checks on a new server render", () => {
    const scheduler = createCheckScheduler();
    const sent: string[] = [];
    scheduler.debounce("f_name", () => sent.push("old"));
    scheduler.clear();
    vi.advanceTimersByTime(CHECK_DEBOUNCE_MS);
    expect(sent).toEqual([]);
  });
});
