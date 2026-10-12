/**
 * The page form's enhancement state: where focus goes after a server render, the submit phase,
 * the offline wait and the latest blur check per field. See specs/ui-ux/renderer.md,
 * "Validation and errors", "Navigation and state" and "Accessibility notes beyond the
 * baseline".
 */

export type SubmitPhase = "idle" | "submitting" | "waiting_uploads" | "waiting_online" | "failed";

export interface PageState {
  phase: SubmitPhase;
  online: boolean;
  /** The submitter value to send again when back online. */
  resend: string | null;
  /** The submitter value of the post in flight or waiting. */
  action: string | null;
  /** The latest blur check id per field. */
  checks: Readonly<Record<string, number>>;
  focus: "summary" | "heading" | null;
}

export type PageEvent =
  /** Every server render: the first load and the page a redirect lands on. */
  | { type: "loaded"; hasSummary: boolean; navigated: boolean }
  /**
   * `holdForRecord`: the first upload of a render without a record is still open, so a post
   * that does not wait for uploads waits for its answer instead (see `bus.ts`).
   */
  | { type: "submit"; action: string; uploadsInFlight: number; holdForRecord?: boolean }
  | { type: "failed" }
  | { type: "uploads_settled" }
  | { type: "offline" }
  | { type: "online" }
  /** A blur check is sent with the new id. */
  | { type: "check"; key: string };

export const initialPageState: PageState = {
  phase: "idle",
  online: true,
  resend: null,
  action: null,
  checks: {},
  focus: null,
};

/** Next and Submit wait for uploads; Back, a language switch and a Remove never do. */
export const waitsForUploads = (action: string): boolean =>
  action === "next" || action === "submit";

export function pageReducer(state: PageState, event: PageEvent): PageState {
  switch (event.type) {
    case "loaded":
      return {
        ...state,
        phase: "idle",
        action: null,
        resend: null,
        focus: event.hasSummary ? "summary" : event.navigated ? "heading" : null,
      };
    case "submit":
      if (state.phase === "submitting") return state;
      if (
        (waitsForUploads(event.action) && event.uploadsInFlight > 0) ||
        event.holdForRecord === true
      )
        return { ...state, phase: "waiting_uploads", action: event.action };
      if (!state.online)
        return { ...state, phase: "waiting_online", action: event.action, resend: event.action };
      return { ...state, phase: "submitting", action: event.action };
    case "failed":
      return { ...state, phase: "failed", action: null };
    case "uploads_settled":
      return state.phase === "waiting_uploads" ? { ...state, phase: "idle", action: null } : state;
    case "offline":
      return { ...state, online: false };
    case "online":
      return state.phase === "waiting_online"
        ? { ...state, online: true, phase: "submitting" }
        : { ...state, online: true };
    case "check":
      return {
        ...state,
        checks: { ...state.checks, [event.key]: (state.checks[event.key] ?? 0) + 1 },
      };
  }
}

/** The latest check of a field wins; an older answer is dropped. */
export function checkIsCurrent(state: PageState, key: string, id: number): boolean {
  return state.checks[key] === id;
}

/** Every button waits while a post is pending; the primary also waits for uploads in flight. */
export function navButtonsState(input: {
  pending: boolean;
  pendingAction: string | null;
  uploadsInFlight: number;
}): { disabled: boolean; primaryDisabled: boolean; submitting: boolean } {
  return {
    disabled: input.pending,
    primaryDisabled: input.pending || input.uploadsInFlight > 0,
    submitting: input.pending && input.pendingAction === "submit",
  };
}
