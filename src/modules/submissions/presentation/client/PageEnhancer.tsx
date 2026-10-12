"use client";

import {
  Component,
  Fragment,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { Locale } from "@/shared/domain/localized-text";
import type { PageFormAction, RefusedFileMessage } from "../page-form-state";
import { styles } from "../styles";
import {
  holdsPosts,
  inFlight,
  onUploadsChange,
  queuePost,
  recordStateFor,
  resetRowsFor,
} from "./bus";
import {
  applyDraft,
  draftKey,
  fieldFormData,
  fieldKeyOf,
  fieldShowsError,
  focusSubmitterAfterFailure,
  loadDraft,
  postedKey,
  readDraft,
  readStored,
  refreshTextarea,
  showFieldError,
  visibleSubmitter,
  writeStored,
} from "./form-dom";
import {
  checkIsCurrent,
  initialPageState,
  type PageEvent,
  pageReducer,
  type PageState,
  type SubmitPhase,
  waitsForUploads,
} from "./page-state";
import { RefusedFilesContext } from "./refused-files";
import { SubmitStateContext } from "./submit-state";

export interface PageEnhancerProps {
  action: PageFormAction;
  slug: string;
  pageKey: string;
  locale: Locale;
  /** The view's `renderedAt`: new on every server render, a redirect back included. */
  renderId: string;
  /** A page change, so focus goes to the heading. */
  navigated: boolean;
  /** Whether this render has an in-progress record; until one exists uploads go one at a time. */
  hasRecord: boolean;
  /** From the server render (the state cookie), never from the action. */
  refusedFiles: readonly RefusedFileMessage[];
  text: { submitting: string; uploadsPending: string; offline: string; submitFailed: string };
  children: ReactNode;
}

/** Next's own control flow (redirect, not found) travels as errors with a `NEXT_` digest. */
function isNextControl(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) return false;
  const { digest } = error;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

interface BoundaryProps {
  /** Whether a page post is in flight, so an error is that post failing. */
  posting: () => boolean;
  onFailed: () => void;
  onRestored: () => void;
  children: ReactNode;
}

/**
 * Catches the page form's action when it rejects (the post never reached the server), React's
 * way to handle form action errors: the form unmounts for one commit and mounts again at once,
 * enabled. Anything else (Next's control flow, a render error) goes on to the next boundary.
 */
class FormBoundary extends Component<BoundaryProps, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(): void {
    this.props.onFailed();
    this.setState({ error: null });
  }

  override componentDidUpdate(_: BoundaryProps, previous: { error: Error | null }): void {
    if (previous.error !== null && this.state.error === null) this.props.onRestored();
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (isNextControl(error) || !this.props.posting()) throw error;
    return null;
  }
}

function pageForm(): HTMLFormElement | null {
  const element = document.getElementById("page-form");
  return element instanceof HTMLFormElement ? element : null;
}

function submitters(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="submit"]'));
}

/** The remembered button, or its visible stand-in once the form mounted again. */
function resendThrough(
  form: HTMLFormElement,
  clicked: HTMLButtonElement | null,
): HTMLButtonElement | null {
  return visibleSubmitter(form, clicked, submitters()) ?? (clicked?.isConnected ? clicked : null);
}

/**
 * The offline banner: always in the page, so assistive technology hears its text when it
 * arrives; empty, it takes no room.
 */
export function OfflineBanner(props: { online: boolean; text: string }): ReactElement {
  return (
    <div role="status" aria-live="polite" data-offline="" className={styles.banner}>
      {props.online ? "" : props.text}
    </div>
  );
}

/**
 * The status lines after the form, always in the page with a fixed politeness: waiting for
 * uploads (polite), the failed post (assertive), and a hidden "Submitting…" (polite).
 */
export function StatusLines(props: {
  phase: SubmitPhase;
  /** The submitter value of the post in flight. */
  action: string | null;
  text: { submitting: string; uploadsPending: string; submitFailed: string };
}): ReactElement {
  const { phase, text } = props;
  return (
    <>
      <p role="status" aria-live="polite" data-status="" className={styles.status}>
        {phase === "waiting_uploads" ? text.uploadsPending : ""}
      </p>
      <p aria-live="assertive" aria-atomic="true" data-submit-failed="" className={styles.status}>
        {phase === "failed" ? text.submitFailed : ""}
      </p>
      <p className={styles.visuallyHidden} aria-live="polite">
        {phase === "submitting" && props.action === "submit" ? text.submitting : ""}
      </p>
    </>
  );
}

function refreshTextareas(form: HTMLFormElement, locale: string): void {
  for (const textarea of form.querySelectorAll("textarea")) refreshTextarea(textarea, locale);
}

/**
 * The page form. Without script the browser posts it multipart to the page's own URL and
 * follows the action's redirect, and nothing below runs. With script it adds focus after each
 * server render, the session-storage draft, blur checks by the server, the submit gate (uploads
 * in flight, offline, Submitting) and the network-failure path; it never calls the action and
 * removing it never blocks completion. See specs/ui-ux/renderer.md, "Validation and errors"
 * and "Navigation and state".
 */
export function PageEnhancer(props: PageEnhancerProps): ReactElement {
  // Before the children render, so kept upload rows never outlive their server render.
  resetRowsFor(props.renderId);

  const [state, dispatch] = useReducer(pageReducer, initialPageState);
  // The same reducer applied as each event happens, for handlers that must act in the event.
  const current = useRef<PageState>(initialPageState);
  const live = useRef(props);
  live.current = props;
  const touched = useRef(new Set<string>());
  // The button of the last post, for the offline resend and for focus after a failure.
  const clicked = useRef<HTMLButtonElement | null>(null);
  // A post held for the first upload's answer (bus.ts).
  const heldPost = useRef<HTMLButtonElement | null>(null);

  const send = useCallback((event: PageEvent): PageState => {
    const next = pageReducer(current.current, event);
    current.current = next;
    dispatch(event);
    return next;
  }, []);

  /** Posts the page natively, before any re-render disables the submitter. */
  const post = useCallback((form: HTMLFormElement, button: HTMLButtonElement): void => {
    const { slug, pageKey } = live.current;
    writeStored(draftKey(slug, pageKey), JSON.stringify(readDraft(form)));
    writeStored(postedKey(slug), pageKey);
    form.requestSubmit(button);
  }, []);

  /** The submit gate for one button: post now, hold for the first upload, or wait. */
  const submit = useCallback(
    (form: HTMLFormElement, button: HTMLButtonElement): void => {
      const before = current.current;
      if (before.phase === "submitting") return;
      const hold = !waitsForUploads(button.value) && holdsPosts();
      const next = send({
        type: "submit",
        action: button.value,
        uploadsInFlight: inFlight(),
        holdForRecord: hold,
      });
      clicked.current = button;
      if (next.phase === "submitting") {
        heldPost.current = null;
        post(form, button);
        return;
      }
      if (!hold) {
        heldPost.current = null;
        return;
      }
      // The latest held post wins; one release sends it.
      const queued = heldPost.current !== null;
      heldPost.current = button;
      if (queued) return;
      queuePost(
        () => {
          const waiting = heldPost.current;
          heldPost.current = null;
          const now = pageForm();
          if (waiting === null || now === null) return;
          const target = resendThrough(now, waiting);
          if (target !== null) submit(now, target);
        },
        () => {
          heldPost.current = null;
        },
      );
    },
    [send, post],
  );

  const check = useCallback(
    (form: HTMLFormElement, key: string): void => {
      const { slug, locale, renderId } = live.current;
      const body = fieldFormData(form, key);
      body.set("_locale", locale);
      const id = send({ type: "check", key }).checks[key] ?? 0;
      fetch(`/f/${encodeURIComponent(slug)}/check`, { method: "POST", body })
        .then((response) => (response.ok ? (response.json() as Promise<unknown>) : null))
        .then((answer) => {
          if (typeof answer !== "object" || answer === null || !("message" in answer)) return;
          const message =
            typeof answer.message === "string"
              ? answer.message
              : answer.message === null
                ? null
                : undefined;
          if (message === undefined) return;
          if (live.current.renderId !== renderId || !checkIsCurrent(current.current, key, id))
            return;
          const now = pageForm();
          if (now !== null) showFieldError(now, key, message, styles.errorIcon ?? "");
        })
        // A failed check is ignored: the server checks the whole page again on Next.
        .catch(() => undefined);
    },
    [send],
  );

  // Every server render: focus, the posted page's draft, and this page's draft.
  useEffect(() => {
    const { slug, pageKey, navigated, locale, hasRecord } = live.current;
    recordStateFor(props.renderId, hasRecord);
    touched.current.clear();
    const summary = document.getElementById("error-summary-heading");
    const next = send({ type: "loaded", hasSummary: summary !== null, navigated });
    const heading = document.querySelector("[data-page-heading]");
    if (next.focus === "summary") summary?.focus();
    else if (next.focus === "heading" && heading instanceof HTMLElement) heading.focus();
    const posted = readStored(postedKey(slug));
    if (posted !== null) {
      // The server now holds those values, as answers or as pending ones.
      writeStored(draftKey(slug, posted), null);
      writeStored(postedKey(slug), null);
    }
    const form = pageForm();
    if (form === null) return;
    const draft = summary === null ? loadDraft(slug, pageKey) : null;
    if (draft !== null) applyDraft(form, draft, "empty_text");
    refreshTextareas(form, locale);
  }, [props.renderId, send]);

  useEffect(() => {
    if (!navigator.onLine) send({ type: "offline" });

    const onClick = (event: MouseEvent): void => {
      const form = pageForm();
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (form === null || button === null || button.type !== "submit" || button.form !== form)
        return;
      event.preventDefault();
      submit(form, button);
    };

    const onField = (event: Event, isInput: boolean): void => {
      const form = pageForm();
      const target = event.target;
      if (form === null || !(target instanceof Element) || !form.contains(target)) return;
      if (target instanceof HTMLInputElement && target.type === "file") return;
      const key = fieldKeyOf(target);
      if (key === null) return;
      const { slug, pageKey, locale } = live.current;
      touched.current.add(key);
      writeStored(draftKey(slug, pageKey), JSON.stringify(readDraft(form)));
      if (target instanceof HTMLTextAreaElement) refreshTextarea(target, locale);
      if (isInput && fieldShowsError(key)) check(form, key);
    };
    const onInput = (event: Event): void => {
      onField(event, true);
    };
    const onChange = (event: Event): void => {
      onField(event, false);
    };

    const onFocusOut = (event: FocusEvent): void => {
      const form = pageForm();
      const target = event.target;
      if (form === null || !(target instanceof Element) || !form.contains(target)) return;
      const key = fieldKeyOf(target);
      if (key === null || !touched.current.has(key)) return;
      const wrapper = target.closest("[data-field]");
      // Moving between the controls of one field (a date's parts, a radio group) is not a blur.
      if (event.relatedTarget instanceof Node && wrapper?.contains(event.relatedTarget)) return;
      // An upload field reports through its own rows.
      if (wrapper?.querySelector('input[type="file"]')) return;
      check(form, key);
    };

    const onOnline = (): void => {
      const before = current.current;
      const next = send({ type: "online" });
      if (before.phase !== "waiting_online" || next.phase !== "submitting") return;
      const form = pageForm();
      const button = form === null ? null : resendThrough(form, clicked.current);
      if (form !== null && button !== null && button.value === next.resend) post(form, button);
      else send({ type: "failed" });
    };
    const onOffline = (): void => {
      send({ type: "offline" });
    };
    const offUploads = onUploadsChange((count) => {
      if (count === 0) send({ type: "uploads_settled" });
    });

    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("input", onInput);
      document.removeEventListener("change", onChange);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      offUploads();
    };
  }, [send, post, check, submit]);

  const failedSubmitter = useRef<HTMLButtonElement | null>(null);
  const posting = useCallback(() => current.current.phase === "submitting", []);
  const onFailed = useCallback(() => {
    failedSubmitter.current = clicked.current;
    // The post never arrived, so its draft must survive the next server render.
    writeStored(postedKey(live.current.slug), null);
    send({ type: "failed" });
  }, [send]);
  const onRestored = useCallback(() => {
    const { slug, pageKey, locale } = live.current;
    const form = pageForm();
    if (form === null) return;
    // The server never received these values: every control gets its draft back.
    const draft = loadDraft(slug, pageKey);
    if (draft !== null) applyDraft(form, draft, "all");
    refreshTextareas(form, locale);
    // The clicked button left with the old form: its visible stand-in, never the hidden default.
    focusSubmitterAfterFailure(form, failedSubmitter.current, submitters());
    failedSubmitter.current = null;
  }, []);

  const pending = state.phase === "submitting";
  const submitState = useMemo(
    () => ({ pending, action: pending ? state.action : null }),
    [pending, state.action],
  );
  const { text } = props;

  return (
    <>
      <OfflineBanner online={state.online} text={text.offline} />
      <FormBoundary posting={posting} onFailed={onFailed} onRestored={onRestored}>
        <form
          id="page-form"
          action={props.action}
          noValidate
          className={styles.form}
          data-slug={props.slug}
          data-page={props.pageKey}
          data-render-id={props.renderId}
          data-navigated={props.navigated ? "" : undefined}
          data-has-record={String(props.hasRecord)}
        >
          {/* Keyed by the render: each server render mounts fresh controls with its values. */}
          <Fragment key={props.renderId}>
            <SubmitStateContext.Provider value={submitState}>
              <RefusedFilesContext.Provider value={props.refusedFiles}>
                {props.children}
              </RefusedFilesContext.Provider>
            </SubmitStateContext.Provider>
          </Fragment>
        </form>
      </FormBoundary>
      {/* Outside the form, so they stay in place while the form mounts again after a failure. */}
      <StatusLines phase={state.phase} action={submitState.action} text={text} />
    </>
  );
}
