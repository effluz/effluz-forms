import { describe, expect, it } from "vitest";
import {
  clearDrafts,
  dropEmptyFiles,
  FOCUS_RING_ATTRIBUTE,
  focusSubmitterAfterFailure,
  type SubmitterLike,
  visibleSubmitter,
} from "./form-dom";

const form = { id: "page-form" };
const otherForm = { id: "other-form" };
const pageFormOf = (): unknown => form;

/** A button as the page form sees it, recording focus and attributes. */
class FakeButton implements SubmitterLike {
  readonly attributes = new Map<string, string>();
  focused = 0;
  private blur: (() => void) | null = null;
  constructor(
    readonly value: string,
    attributes: Record<string, string> = {},
    public isConnected = true,
    readonly form: unknown = pageFormOf(),
  ) {
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  addEventListener(type: string, listener: () => void): void {
    if (type === "blur") this.blur = listener;
  }
  focus(): void {
    this.focused += 1;
  }
  blurNow(): void {
    this.blur?.();
  }
}

/** PublicShell's hidden default action, then the navigation row and the language switch. */
function page(): {
  hiddenDefault: FakeButton;
  back: FakeButton;
  primary: FakeButton;
  language: FakeButton;
  all: FakeButton[];
} {
  const hiddenDefault = new FakeButton("next", { "aria-hidden": "true", tabindex: "-1" });
  const language = new FakeButton("language:es");
  const back = new FakeButton("back");
  const primary = new FakeButton("next", { "data-primary": "" });
  return { hiddenDefault, back, primary, language, all: [hiddenDefault, language, back, primary] };
}

describe("the submitter to resend or focus", () => {
  it("is the clicked button itself while it is still on the page and visible", () => {
    const { language, back, all } = page();
    expect(visibleSubmitter(form, language, all)).toBe(language);
    expect(visibleSubmitter(form, back, all)).toBe(back);
  });

  it("is never the hidden default button: Enter in a field resolves to the visible primary", () => {
    const { hiddenDefault, primary, all } = page();
    expect(visibleSubmitter(form, hiddenDefault, all)).toBe(primary);
  });

  it("is the remounted button with the same value when the clicked one left the page", () => {
    const { primary, back, all } = page();
    const oldPrimary = new FakeButton("next", { "data-primary": "" }, false);
    const oldBack = new FakeButton("back", {}, false);
    expect(visibleSubmitter(form, oldPrimary, all)).toBe(primary);
    expect(visibleSubmitter(form, oldBack, all)).toBe(back);
    expect(visibleSubmitter(form, null, all)).toBeNull();
    // A button of another form never stands in.
    const elsewhere = new FakeButton("back", {}, true, otherForm);
    expect(visibleSubmitter(form, oldBack, [elsewhere])).toBeNull();
  });
});

describe("focus after a failed post", () => {
  it("lands on the visible primary with the page's focus ring, never on the hidden default button", () => {
    const { hiddenDefault, primary, all } = page();
    // The post left through the hidden default (Enter), and the form mounted again.
    const target = focusSubmitterAfterFailure(form, hiddenDefault, all);
    expect(target).toBe(primary);
    expect(primary.focused).toBe(1);
    expect(hiddenDefault.focused).toBe(0);
    expect(primary.hasAttribute(FOCUS_RING_ATTRIBUTE)).toBe(true);
    // The ring is for this focus only: it goes when focus moves on.
    primary.blurNow();
    expect(primary.hasAttribute(FOCUS_RING_ATTRIBUTE)).toBe(false);
  });

  it("does nothing when no post was remembered", () => {
    const { all } = page();
    expect(focusSubmitterAfterFailure(form, null, all)).toBeNull();
    for (const button of all) expect(button.focused).toBe(0);
  });
});

describe("clearDrafts", () => {
  it("removes every draft and the posted marker of the form, and nothing else", () => {
    const items = new Map([
      ["effluz:story-form:page_1", "{}"],
      ["effluz:story-form:posted", "page_2"],
      ["effluz:story-form:page_2", "{}"],
      ["effluz:story-form-2:page_1", "{}"],
      ["other", "x"],
    ]);
    const store = {
      get length() {
        return items.size;
      },
      key: (index: number) => [...items.keys()][index] ?? null,
      removeItem: (key: string) => {
        items.delete(key);
      },
    };
    clearDrafts("story-form", store);
    expect([...items.keys()]).toEqual(["effluz:story-form-2:page_1", "other"]);
  });

  it("ignores blocked storage", () => {
    expect(() => {
      clearDrafts("story-form", null);
    }).not.toThrow();
    const blocked = {
      get length(): number {
        throw new Error("blocked");
      },
      key: () => null,
      removeItem: () => undefined,
    };
    expect(() => {
      clearDrafts("story-form", blocked);
    }).not.toThrow();
  });
});

describe("dropEmptyFiles", () => {
  it("leaves the cleared file input's empty part out of a page post, and keeps every other entry", () => {
    const data = new FormData();
    data.append("_page", "page5");
    data.append("photos", new File([], ""));
    data.append("video", new File([], ""));
    data.append("video", new File([new Uint8Array([1, 2, 3])], "chosen-before-script.mp4"));
    data.append("consent", "accepted");

    dropEmptyFiles(data);

    expect(data.has("photos")).toBe(false);
    expect(data.getAll("video").map((v) => (typeof v === "string" ? v : v.name))).toEqual([
      "chosen-before-script.mp4",
    ]);
    expect(data.get("_page")).toBe("page5");
    expect(data.get("consent")).toBe("accepted");
  });

  it("keeps an empty file the person chose by name, for the server to refuse", () => {
    const data = new FormData();
    data.append("photos", new File([], "empty.jpg"));

    dropEmptyFiles(data);

    expect(data.getAll("photos")).toHaveLength(1);
  });
});
