import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildDefaultRegistry } from "@/shared/domain/form-model";
import { makeSubmissionsDeps, publishStory } from "../application/testing/fakes";
import { viewForm } from "../application/view-form";
import { focusTitle } from "./client/form-dom";
import type { PageFormAction } from "./page-form-state";
import { ErrorScreen, RendererScreen } from "./Screens";

// The client pieces run effects only in the browser; here they leave a mark where they mount.
vi.mock("./client/ClearDrafts", () => ({
  ClearDrafts: (props: { slug: string }): ReactElement =>
    createElement("i", { "data-clears-drafts": props.slug }),
}));
vi.mock("./client/ClearPostedMarker", () => ({
  ClearPostedMarker: (props: { slug: string }): ReactElement =>
    createElement("i", { "data-clears-posted": props.slug }),
}));
vi.mock("./client/FocusTitle", () => ({
  FocusTitle: (): ReactElement => createElement("i", { "data-focuses-title": "" }),
}));

const registry = buildDefaultRegistry();
const noop: PageFormAction = () => Promise.resolve();

async function screenFor(state: Parameters<typeof viewForm>[1]["state"], expired: boolean) {
  const deps = makeSubmissionsDeps();
  await publishStory(deps);
  const view = await viewForm(deps, {
    slug: "story-form",
    state,
    acceptLanguage: "en",
    expired,
  });
  if (view.screen === "not_found") throw new Error("not found");
  return {
    screen: view.screen,
    html: renderToStaticMarkup(
      createElement(RendererScreen, {
        view,
        slug: "story-form",
        contact: "privacy@example.com",
        registry,
        formAction: noop,
        refusedFiles: [],
      }),
    ),
  };
}

describe("client pieces of the end screens", () => {
  it("the confirmation clears the drafts and focuses its heading, which can take focus", async () => {
    const { screen, html } = await screenFor({ kind: "decoy", reference: "ST-1234" }, false);
    expect(screen).toBe("confirmation");
    expect(html).toContain('data-clears-drafts="story-form"');
    expect(html).toContain("data-focuses-title");
    expect(html).toMatch(/<h1 id="page-title" tabindex="-1"/);
  });

  it("the expired screen clears the drafts, so an old fill never reaches a new submission", async () => {
    const { screen, html } = await screenFor({ kind: "none" }, true);
    expect(screen).toBe("expired");
    expect(html).toContain('data-clears-drafts="story-form"');
    expect(html).not.toContain("data-focuses-title");
  });
});

describe("the error screen after a scripted post failed", () => {
  const html = renderToStaticMarkup(
    createElement(ErrorScreen, { tryAgainHref: "/f/story-form", slug: "story-form" }),
  );

  it("drops the posted marker only, so Try again restores the page's edits", () => {
    expect(html).toContain('data-clears-posted="story-form"');
    expect(html).not.toContain("data-clears-drafts");
  });

  it("focuses its heading, which can take focus", () => {
    expect(html).toContain("data-focuses-title");
    expect(html).toMatch(/<h1 id="page-title" tabindex="-1"/);
  });

  it("mounts no marker piece when no form is known", () => {
    const bare = renderToStaticMarkup(createElement(ErrorScreen, { tryAgainHref: "/" }));
    expect(bare).not.toContain("data-clears-posted");
    expect(bare).toContain("data-focuses-title");
  });
});

describe("focusTitle", () => {
  it("focuses the screen's heading, and does nothing when there is none", () => {
    const heading = {
      focused: 0,
      focus(): void {
        this.focused += 1;
      },
    };
    focusTitle((id) => (id === "page-title" ? heading : null));
    expect(heading.focused).toBe(1);
    expect(() => {
      focusTitle(() => null);
    }).not.toThrow();
  });
});
