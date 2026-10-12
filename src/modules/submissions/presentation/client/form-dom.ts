/**
 * Browser helpers of the page form's enhancement, over the server markup of Tasks 24 and 25 (no
 * React). Messages written here come from the server already localized and are always set as
 * text, never parsed as markup. See specs/ui-ux/renderer.md, "Validation and errors" and
 * "Navigation and state".
 */

/** A page's unsent values by control name: what session storage keeps between renders. */
export type Draft = Record<string, string[]>;

const belongsTo = (name: string, key: string): boolean =>
  name === key || name.startsWith(`${key}.`);

/** The inputs named `key` or `key.*` plus `_field`: the body of a blur check. */
export function fieldFormData(form: HTMLFormElement, key: string): FormData {
  const body = new FormData();
  for (const [name, value] of new FormData(form)) {
    if (typeof value === "string" && belongsTo(name, key)) body.append(name, value);
  }
  body.set("_field", key);
  return body;
}

const isEmptyPart = (value: FormDataEntryValue): boolean =>
  typeof value !== "string" && value.size === 0 && value.name === "";

/**
 * Leaves out the empty part a file input with nothing chosen adds to a post. With script each
 * file uploads early and the input is cleared, and the Server Action's encoding turns that
 * nameless part into a file named "blob", which the server would refuse as a wrong type. A
 * file chosen before the script took over still goes with the post. See
 * specs/ui-ux/renderer.md, "File upload".
 */
export function dropEmptyFiles(data: FormData): void {
  const names = new Set<string>();
  for (const [name, value] of data) if (isEmptyPart(value)) names.add(name);
  for (const name of names) {
    const kept = data.getAll(name).filter((value) => !isEmptyPart(value));
    data.delete(name);
    for (const value of kept) data.append(name, value);
  }
}

/** Replaces `{word}` placeholders; unknown ones stay as written. */
export const fill = (text: string, vars: Record<string, string>): string =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);

/** The key of the field an element sits in, from its `[data-field]` wrapper. */
export function fieldKeyOf(element: Element): string | null {
  return element.closest("[data-field]")?.getAttribute("data-field") ?? null;
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isControl(element: Element): element is Control {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

/** The answer controls of the page: inside a field, named, not files, not underscore names. */
function answerControls(form: HTMLFormElement): Control[] {
  return Array.from(form.elements).filter(
    (element): element is Control =>
      isControl(element) &&
      element.name !== "" &&
      !element.name.startsWith("_") &&
      !element.name.startsWith("$") &&
      element.type !== "file" &&
      element.closest("[data-field]") !== null,
  );
}

function controlsOf(form: HTMLFormElement, key: string): Control[] {
  return answerControls(form).filter((control) => belongsTo(control.name, key));
}

const isChoice = (control: Control): control is HTMLInputElement =>
  control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio");

/** The page's values; a checkbox or radio group with nothing chosen is kept as an empty list. */
export function readDraft(form: HTMLFormElement): Draft {
  const draft: Draft = {};
  for (const control of answerControls(form)) {
    const values = (draft[control.name] ??= []);
    if (isChoice(control)) {
      if (control.checked) values.push(control.value);
    } else if (control instanceof HTMLSelectElement && control.multiple) {
      for (const option of control.selectedOptions) values.push(option.value);
    } else {
      values.push(control.value);
    }
  }
  return draft;
}

/**
 * Writes a draft back. `empty_text` fills only empty text inputs and textareas (a restore on
 * load must not overwrite what the server rendered); `all` sets every control the draft names
 * (after a post that never reached the server).
 */
export function applyDraft(form: HTMLFormElement, draft: Draft, mode: "empty_text" | "all"): void {
  const seen = new Map<string, number>();
  for (const control of answerControls(form)) {
    const values = draft[control.name];
    if (values === undefined) continue;
    if (isChoice(control)) {
      if (mode === "all") control.checked = values.includes(control.value);
      continue;
    }
    if (control instanceof HTMLSelectElement) {
      if (mode === "all") {
        for (const option of control.options) option.selected = values.includes(option.value);
      }
      continue;
    }
    const index = seen.get(control.name) ?? 0;
    seen.set(control.name, index + 1);
    const value = values[index];
    if (value === undefined) continue;
    if (mode === "all" || control.value === "") control.value = value;
  }
}

const storage = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export const draftKey = (slug: string, pageKey: string): string => `effluz:${slug}:${pageKey}`;
export const postedKey = (slug: string): string => `effluz:${slug}:posted`;

export function readStored(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, value);
  } catch {
    // Storage full or blocked: the draft is a convenience, the server keeps every sent page.
  }
}

/**
 * Removes every draft and the posted marker of a form from session storage, once the form is
 * submitted, so no answer stays in the tab.
 */
export function clearDrafts(
  slug: string,
  store: Pick<Storage, "length" | "key" | "removeItem"> | null = storage(),
): void {
  if (store === null) return;
  const prefix = `effluz:${slug}:`;
  try {
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Blocked storage holds no drafts.
  }
}

/** What the submit gate reads of a submit button; `HTMLButtonElement` has all of it. */
export interface SubmitterLike {
  readonly isConnected: boolean;
  readonly value: string;
  readonly form: unknown;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
}

/**
 * The button to send a post again or to focus after one failed: the clicked button while it is
 * on the page and visible, else the visible button of the page form with its value, the primary
 * first. Never PublicShell's `aria-hidden` default button, which Enter in a field clicks.
 */
export function visibleSubmitter<T extends SubmitterLike>(
  form: unknown,
  clicked: T | null,
  buttons: Iterable<T>,
): T | null {
  if (clicked === null) return null;
  const visible = (button: T): boolean =>
    button.isConnected && button.form === form && button.getAttribute("aria-hidden") !== "true";
  if (visible(clicked)) return clicked;
  let match: T | null = null;
  for (const button of buttons) {
    if (!visible(button) || button.value !== clicked.value) continue;
    if (button.hasAttribute("data-primary")) return button;
    match ??= button;
  }
  return match;
}

/** Marks a control focused by script, so it shows the focus ring (renderer.module.css). */
export const FOCUS_RING_ATTRIBUTE = "data-focus-ring";

interface Focusable {
  focus: (options?: FocusOptions) => void;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  addEventListener: (type: "blur", listener: () => void, options?: { once: boolean }) => void;
}

/** Focuses with a visible ring, even where the browser would not match `:focus-visible`. */
export function focusWithRing(element: Focusable): void {
  element.setAttribute(FOCUS_RING_ATTRIBUTE, "");
  element.addEventListener(
    "blur",
    () => {
      element.removeAttribute(FOCUS_RING_ATTRIBUTE);
    },
    { once: true },
  );
  const options: FocusOptions & { focusVisible?: boolean } = { focusVisible: true };
  element.focus(options);
}

/** After a failed post, focus goes back to the visible button that sent it. */
export function focusSubmitterAfterFailure<T extends SubmitterLike & Focusable>(
  form: unknown,
  clicked: T | null,
  buttons: Iterable<T>,
): T | null {
  const target = visibleSubmitter(form, clicked, buttons);
  if (target !== null) focusWithRing(target);
  return target;
}

export function loadDraft(slug: string, pageKey: string): Draft | null {
  const stored = readStored(draftKey(slug, pageKey));
  if (stored === null) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return null;
    const draft: Draft = {};
    for (const [name, values] of Object.entries(parsed)) {
      if (Array.isArray(values)) draft[name] = values.filter((v) => typeof v === "string");
    }
    return draft;
  } catch {
    return null;
  }
}

const SVG = "http://www.w3.org/2000/svg";

/** The same mark as `ErrorIcon`, built in the browser for a message the server sent. */
function errorIcon(className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", className);
  const circle = document.createElementNS(SVG, "circle");
  for (const [name, value] of Object.entries({
    cx: "8",
    cy: "8",
    r: "7",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
  }))
    circle.setAttribute(name, value);
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M8 4v5M8 11.5v.5");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  svg.append(circle, path);
  return svg;
}

function setDescribedBy(element: Element, id: string, present: boolean): void {
  const tokens = (element.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  const has = tokens.includes(id);
  if (present && !has) element.setAttribute("aria-describedby", [...tokens, id].join(" "));
  if (!present && has) {
    const rest = tokens.filter((token) => token !== id);
    if (rest.length === 0) element.removeAttribute("aria-describedby");
    else element.setAttribute("aria-describedby", rest.join(" "));
  }
}

/** Whether the field's error slot shows a message now. */
export function fieldShowsError(key: string): boolean {
  return (document.getElementById(`${key}-error`)?.textContent ?? "").trim() !== "";
}

/**
 * Writes a blur check's answer into the field's error slot and sets or clears `aria-invalid`.
 * The slot sits in server markup that React remounts on the next server render, so writing it
 * here never fights React.
 */
export function showFieldError(
  form: HTMLFormElement,
  key: string,
  message: string | null,
  iconClass: string,
): void {
  const errorId = `${key}-error`;
  const slot = document.getElementById(errorId);
  if (slot === null) return;
  slot.replaceChildren();
  if (message !== null) slot.append(errorIcon(iconClass), document.createTextNode(message));
  const wrapper = form.querySelector(`[data-field="${CSS.escape(key)}"]`);
  const group = wrapper instanceof HTMLFieldSetElement ? wrapper : null;
  const targets: Element[] = [...controlsOf(form, key), ...(group ? [group] : [])];
  for (const target of targets) {
    if (message !== null) target.setAttribute("aria-invalid", "true");
    else target.removeAttribute("aria-invalid");
  }
  // A group is described by its fieldset; a single control by itself.
  for (const target of group ? [group] : controlsOf(form, key))
    setDescribedBy(target, errorId, message !== null);
}

const graphemes = (text: string): number => {
  if (typeof Intl.Segmenter === "function")
    return Array.from(new Intl.Segmenter().segment(text)).length;
  return Array.from(text).length;
};

/**
 * Grows an auto-growing textarea to its content and updates its character counter, which
 * becomes a polite live region from 90 % of the maximum.
 */
export function refreshTextarea(textarea: HTMLTextAreaElement, locale: string): void {
  if (textarea.hasAttribute("data-autogrow")) {
    textarea.style.height = "auto";
    textarea.style.height = `${String(textarea.scrollHeight)}px`;
  }
  if (textarea.id === "") return;
  const counter = document.querySelector(`[data-counter-for="${CSS.escape(textarea.id)}"]`);
  const template = counter?.getAttribute("data-template");
  if (!counter || !template) return;
  const n = graphemes(textarea.value);
  counter.textContent = fill(template, { n: new Intl.NumberFormat(locale).format(n) });
  const max = Number(counter.getAttribute("data-max"));
  if (Number.isFinite(max) && max > 0 && n >= max * 0.9)
    counter.setAttribute("aria-live", "polite");
  else counter.removeAttribute("aria-live");
}
