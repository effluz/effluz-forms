import { describe, expect, it } from "vitest";
import {
  checkIsCurrent,
  initialPageState,
  navButtonsState,
  pageReducer,
  type PageEvent,
  type PageState,
  waitsForUploads,
} from "./page-state";

const run = (events: PageEvent[], from: PageState = initialPageState) =>
  events.reduce(pageReducer, from);

describe("focus target", () => {
  it("is the summary after a refused post, the heading after a page change, and nothing on a fresh page 1", () => {
    expect(run([{ type: "loaded", hasSummary: true, navigated: true }]).focus).toBe("summary");
    expect(run([{ type: "loaded", hasSummary: false, navigated: true }]).focus).toBe("heading");
    expect(run([{ type: "loaded", hasSummary: false, navigated: false }]).focus).toBeNull();
    const landed = run([
      { type: "loaded", hasSummary: false, navigated: false },
      { type: "submit", action: "next", uploadsInFlight: 0 },
      { type: "loaded", hasSummary: true, navigated: false },
    ]);
    expect(landed).toMatchObject({ phase: "idle", action: null, focus: "summary" });
  });
});

describe("blur queue", () => {
  it("applies only the latest check of a field", () => {
    const state = run([
      { type: "check", key: "f_email" },
      { type: "check", key: "f_email" },
      { type: "check", key: "f_name" },
    ]);
    expect(checkIsCurrent(state, "f_email", 1)).toBe(false);
    expect(checkIsCurrent(state, "f_email", 2)).toBe(true);
    expect(checkIsCurrent(state, "f_name", 1)).toBe(true);
  });
});

describe("offline state", () => {
  it("waits for the connection and sends the same action again when it returns", () => {
    const waiting = run([
      { type: "offline" },
      { type: "submit", action: "next", uploadsInFlight: 0 },
    ]);
    expect(waiting).toMatchObject({ phase: "waiting_online", online: false, resend: "next" });
    expect(run([{ type: "online" }], waiting)).toMatchObject({
      phase: "submitting",
      online: true,
      resend: "next",
    });
  });
});

describe("submitting state", () => {
  it("submits once, waits for uploads, and re-enables with the failure message", () => {
    const submitting = run([{ type: "submit", action: "submit", uploadsInFlight: 0 }]);
    expect(submitting.phase).toBe("submitting");
    expect(run([{ type: "submit", action: "submit", uploadsInFlight: 0 }], submitting)).toBe(
      submitting,
    );
    expect(run([{ type: "failed" }], submitting).phase).toBe("failed");
    const waiting = run([{ type: "submit", action: "next", uploadsInFlight: 2 }]);
    expect(waiting.phase).toBe("waiting_uploads");
    expect(run([{ type: "uploads_settled" }], waiting).phase).toBe("idle");
    expect(run([{ type: "submit", action: "back", uploadsInFlight: 2 }]).phase).toBe("submitting");
  });

  it("holds a Back or a language switch while the first upload creates the record, then sends it", () => {
    const held = run([
      { type: "submit", action: "language:es", uploadsInFlight: 1, holdForRecord: true },
    ]);
    expect(held).toMatchObject({ phase: "waiting_uploads", action: "language:es" });
    expect(
      run([{ type: "submit", action: "back", uploadsInFlight: 1, holdForRecord: true }]).phase,
    ).toBe("waiting_uploads");
    // Released: the same post again, now that the record exists.
    expect(
      run([{ type: "submit", action: "language:es", uploadsInFlight: 1 }], held),
    ).toMatchObject({ phase: "submitting", action: "language:es" });
    expect(waitsForUploads("next")).toBe(true);
    expect(waitsForUploads("submit")).toBe(true);
    expect(waitsForUploads("language:es")).toBe(false);
    expect(waitsForUploads("back")).toBe(false);
  });

  it("disables every button while submitting, shows Submitting only for Submit, and holds the primary for uploads", () => {
    expect(navButtonsState({ pending: true, pendingAction: "submit", uploadsInFlight: 0 })).toEqual(
      { disabled: true, primaryDisabled: true, submitting: true },
    );
    expect(navButtonsState({ pending: true, pendingAction: "next", uploadsInFlight: 0 })).toEqual({
      disabled: true,
      primaryDisabled: true,
      submitting: false,
    });
    expect(navButtonsState({ pending: false, pendingAction: null, uploadsInFlight: 1 })).toEqual({
      disabled: false,
      primaryDisabled: true,
      submitting: false,
    });
  });
});
