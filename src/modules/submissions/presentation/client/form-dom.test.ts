import { describe, expect, it } from "vitest";
import {
  applyDraftTo,
  clearDrafts,
  counterText,
  type DraftControl,
  dropEmptyFiles,
  FOCUS_RING_ATTRIBUTE,
  focusSubmitterAfterFailure,
  linkFieldError,
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

describe("the character counter", () => {
  const template = "{n} of 500 characters";

  it("always shows the count, and gives the polite region text only from 90 percent", () => {
    expect(counterText(template, 449, 500, "en")).toEqual({
      shown: "449 of 500 characters",
      announced: "",
    });
    expect(counterText(template, 450, 500, "en")).toEqual({
      shown: "450 of 500 characters",
      announced: "450 of 500 characters",
    });
    expect(counterText("{n} de 2000 caracteres", 1950, 2000, "es").announced).toBe(
      "1950 de 2000 caracteres",
    );
    expect(counterText(template, 10, Number.NaN, "en").announced).toBe("");
  });
});

/** A control as the draft code reads it. */
function control(name: string, type: string, over: Partial<DraftControl> = {}): DraftControl {
  return { name, type, value: "", checked: false, ...over };
}

function select(name: string, values: string[], selected: string): DraftControl {
  return {
    name,
    type: "select-one",
    value: selected,
    options: values.map((value) => ({ value, selected: value === selected })),
  };
}

const selectedOf = (control: DraftControl): string[] =>
  [...(control.options ?? [])].filter((o) => o.selected).map((o) => o.value);

describe("restoring a draft on load", () => {
  it("fills empty text controls only, leaving what the server rendered", () => {
    const empty = control("f_name", "text");
    const rendered = control("f_city", "text", { value: "Server value" });
    applyDraftTo([empty, rendered], { f_name: ["Draft"], f_city: ["Draft city"] }, "empty_text");
    expect(empty.value).toBe("Draft");
    expect(rendered.value).toBe("Server value");
  });

  it("restores a radio group, a checkbox group and a single checkbox with nothing chosen", () => {
    const radios = [
      control("f_baby", "radio", { value: "yes" }),
      control("f_baby", "radio", { value: "no" }),
    ];
    const boxes = [
      control("f_pick", "checkbox", { value: "a" }),
      control("f_pick", "checkbox", { value: "b" }),
      control("f_pick", "checkbox", { value: "c" }),
    ];
    const single = control("f_ok", "checkbox", { value: "on" });
    applyDraftTo(
      [...radios, ...boxes, single],
      { f_baby: ["no"], f_pick: ["a", "c"], f_ok: ["on"] },
      "empty_text",
    );
    expect(radios.map((r) => r.checked)).toEqual([false, true]);
    expect(boxes.map((b) => b.checked)).toEqual([true, false, true]);
    expect(single.checked).toBe(true);
  });

  it("leaves a group the server rendered with a choice as it is", () => {
    const radios = [
      control("f_baby", "radio", { value: "yes", checked: true }),
      control("f_baby", "radio", { value: "no" }),
    ];
    const boxes = [
      control("f_pick", "checkbox", { value: "a" }),
      control("f_pick", "checkbox", { value: "b", checked: true }),
    ];
    applyDraftTo([...radios, ...boxes], { f_baby: ["no"], f_pick: ["a"] }, "empty_text");
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
    expect(boxes.map((b) => b.checked)).toEqual([false, true]);
  });

  it("restores a select on its placeholder, and leaves one with a choice", () => {
    const blank = select("f_country", ["", "pa", "cr"], "");
    const chosen = select("f_region", ["", "north", "south"], "north");
    applyDraftTo([blank, chosen], { f_country: ["cr"], f_region: ["south"] }, "empty_text");
    expect(selectedOf(blank)).toEqual(["cr"]);
    expect(selectedOf(chosen)).toEqual(["north"]);
  });

  it("sets every control after a post that never reached the server", () => {
    const radios = [
      control("f_baby", "radio", { value: "yes", checked: true }),
      control("f_baby", "radio", { value: "no" }),
    ];
    const text = control("f_name", "text", { value: "Server" });
    const chosen = select("f_region", ["", "north", "south"], "north");
    applyDraftTo(
      [...radios, text, chosen],
      { f_baby: ["no"], f_name: ["Draft"], f_region: ["south"] },
      "all",
    );
    expect(radios.map((r) => r.checked)).toEqual([false, true]);
    expect(text.value).toBe("Draft");
    expect(selectedOf(chosen)).toEqual(["south"]);
  });
});

/** An element as the error linkage reads and writes it. */
class FakeElement {
  readonly attributes = new Map<string, string>();
  constructor(attributes: Record<string, string> = {}) {
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
}

describe("linking a blur check's error", () => {
  it("describes a group by its fieldset, and the consent checkbox too, as the server render does", () => {
    const fieldset = new FakeElement({ "aria-describedby": "f_consent-help" });
    const box = new FakeElement({ "data-own-error": "" });
    linkFieldError(fieldset, [box], "f_consent-error", true);
    expect(fieldset.getAttribute("aria-describedby")).toBe("f_consent-help f_consent-error");
    expect(box.getAttribute("aria-describedby")).toBe("f_consent-error");
    expect(fieldset.getAttribute("aria-invalid")).toBe("true");
    expect(box.getAttribute("aria-invalid")).toBe("true");

    linkFieldError(fieldset, [box], "f_consent-error", false);
    expect(fieldset.getAttribute("aria-describedby")).toBe("f_consent-help");
    expect(box.hasAttribute("aria-describedby")).toBe(false);
    expect(box.hasAttribute("aria-invalid")).toBe(false);
  });

  it("describes a radio group by its fieldset only, and a single control by itself", () => {
    const fieldset = new FakeElement();
    const radios = [new FakeElement(), new FakeElement()];
    linkFieldError(fieldset, radios, "f_baby-error", true);
    expect(fieldset.getAttribute("aria-describedby")).toBe("f_baby-error");
    for (const radio of radios) {
      expect(radio.hasAttribute("aria-describedby")).toBe(false);
      expect(radio.getAttribute("aria-invalid")).toBe("true");
    }
    const input = new FakeElement({ "aria-describedby": "f_name-help" });
    linkFieldError(null, [input], "f_name-error", true);
    expect(input.getAttribute("aria-describedby")).toBe("f_name-help f_name-error");
  });
});
