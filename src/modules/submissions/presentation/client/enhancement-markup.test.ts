import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fill } from "./form-dom";
import { NavButtons } from "./NavButtons";
import { PageEnhancer, type PageEnhancerProps } from "./PageEnhancer";
import { SubmitStateContext } from "./submit-state";

const nav = (): ReturnType<typeof createElement> =>
  createElement(NavButtons, {
    back: "Back",
    primary: { value: "submit", label: "Submit" },
    submitting: "Submitting…",
    uploadsPending: "Wait for uploads to finish before continuing",
  });

const buttons = (html: string): string[] => html.match(/<button[^>]*>/g) ?? [];

describe("NavButtons", () => {
  it("renders enabled Back and Submit without a spinner when nothing is pending", () => {
    const html = renderToStaticMarkup(nav());
    expect(buttons(html)).toHaveLength(2);
    for (const tag of buttons(html)) expect(tag).not.toContain("disabled");
    expect(html).toContain(">Submit<");
    expect(html).not.toContain("Submitting…");
    expect(html).not.toContain("Wait for uploads");
  });

  it("disables every button and shows the hidden spinner and Submitting while Submit is pending", () => {
    const html = renderToStaticMarkup(
      createElement(
        SubmitStateContext.Provider,
        { value: { pending: true, action: "submit" } },
        nav(),
      ),
    );
    const tags = buttons(html);
    expect(tags).toHaveLength(2);
    for (const tag of tags) expect(tag).toContain("disabled");
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*><\/span>Submitting…/);
    // The submitter keeps its value: a disabled button is never the one that posts.
    expect(tags[1]).toContain('value="submit"');
  });

  it("disables without Submitting while Next is pending", () => {
    const html = renderToStaticMarkup(
      createElement(
        SubmitStateContext.Provider,
        { value: { pending: true, action: "next" } },
        createElement(NavButtons, {
          back: null,
          primary: { value: "next", label: "Next" },
          submitting: "Submitting…",
          uploadsPending: "Wait",
        }),
      ),
    );
    expect(buttons(html)[0]).toContain("disabled");
    expect(html).toContain(">Next<");
    expect(html).not.toContain("Submitting…");
  });
});

function enhancer(over: Partial<PageEnhancerProps> = {}): string {
  return renderToStaticMarkup(
    createElement(PageEnhancer, {
      action: () => Promise.resolve(),
      slug: "story-form",
      pageKey: "p1",
      locale: "en",
      renderId: "2026-10-10T09:00:00.000Z",
      navigated: false,
      refusedFiles: [],
      text: {
        submitting: "Submitting…",
        uploadsPending: "Wait for uploads to finish before continuing",
        offline: "You seem to be offline. We will continue when you reconnect.",
        submitFailed: "Your answers were not sent. Check your connection and try again.",
      },
      children: createElement("input", { name: "f_name", defaultValue: "" }),
      ...over,
    }),
  );
}

describe("PageEnhancer without script", () => {
  it("renders the page form with its children and an empty status line, and no offline banner", () => {
    const html = enhancer();
    expect(html).toMatch(/<form[^>]*id="page-form"/);
    expect(html).toContain('name="f_name"');
    expect(html).toMatch(/<p[^>]*role="status"[^>]*data-status=""[^>]*><\/p>/);
    expect(html).not.toContain("You seem to be offline");
    expect(html).not.toContain("Your answers were not sent");
  });
});

describe("fill", () => {
  it("replaces known placeholders and leaves the others", () => {
    expect(fill("{count} of {max} files", { count: "2", max: "10" })).toBe("2 of 10 files");
    expect(fill("{file} removed", {})).toBe("{file} removed");
  });
});
