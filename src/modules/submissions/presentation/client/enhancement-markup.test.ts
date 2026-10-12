import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fill } from "./form-dom";
import { NavButtons } from "./NavButtons";
import { OfflineBanner, PageEnhancer, type PageEnhancerProps, StatusLines } from "./PageEnhancer";
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
        { value: { pending: true, action: "submit", waiting: false } },
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
        { value: { pending: true, action: "next", waiting: false } },
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
      hasRecord: false,
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

const text = {
  submitting: "Submitting…",
  uploadsPending: "Wait for uploads to finish before continuing",
  submitFailed: "Your answers were not sent. Check your connection and try again.",
};

/** The opening tag of the element carrying `marker`. */
const tagWith = (html: string, marker: string): string =>
  new RegExp(`<[a-z]+[^>]*${marker}[^>]*>`).exec(html)?.[0] ?? "";

describe("live regions", () => {
  it("are in the page from the first render, empty, each with a fixed politeness", () => {
    const html = enhancer();
    const banner = tagWith(html, "data-offline");
    expect(banner).toContain('role="status"');
    expect(banner).toContain('aria-live="polite"');
    expect(html).toMatch(/data-offline=""[^>]*><\/div>/);
    const status = tagWith(html, "data-status");
    expect(status).toContain('aria-live="polite"');
    expect(html).toMatch(/data-status=""[^>]*><\/p>/);
    const failed = tagWith(html, "data-submit-failed");
    expect(failed).toContain('aria-live="assertive"');
    expect(html).toMatch(/data-submit-failed=""[^>]*><\/p>/);
    // The form says whether the server render has an in-progress record yet.
    expect(tagWith(html, 'id="page-form"')).toContain('data-has-record="false"');
    expect(tagWith(enhancer({ hasRecord: true }), 'id="page-form"')).toContain(
      'data-has-record="true"',
    );
  });

  it("receive the failure and the offline text inside the same elements", () => {
    const lines = (phase: "idle" | "failed" | "waiting_uploads"): string =>
      renderToStaticMarkup(createElement(StatusLines, { phase, action: null, text }));
    const idle = lines("idle");
    const failed = lines("failed");
    expect(tagWith(failed, "data-submit-failed")).toBe(tagWith(idle, "data-submit-failed"));
    expect(failed).toMatch(/data-submit-failed=""[^>]*>Your answers were not sent/);
    expect(failed).toMatch(/data-status=""[^>]*><\/p>/);
    const waiting = lines("waiting_uploads");
    expect(tagWith(waiting, "data-status")).toBe(tagWith(idle, "data-status"));
    expect(waiting).toMatch(/data-status=""[^>]*>Wait for uploads/);

    const banner = (online: boolean): string =>
      renderToStaticMarkup(
        createElement(OfflineBanner, {
          online,
          text: "You seem to be offline. We will continue when you reconnect.",
        }),
      );
    expect(tagWith(banner(false), "data-offline")).toBe(tagWith(banner(true), "data-offline"));
    expect(banner(false)).toMatch(/data-offline=""[^>]*>You seem to be offline/);
  });
});

describe("fill", () => {
  it("replaces known placeholders and leaves the others", () => {
    expect(fill("{count} of {max} files", { count: "2", max: "10" })).toBe("2 of 10 files");
    expect(fill("{file} removed", {})).toBe("{file} removed");
  });
});
