import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FormOverview as Overview } from "../application";
import { BuilderPlaceholder } from "./BuilderPlaceholder";
import {
  FormOverview,
  overviewDialog,
  overviewError,
  SubmissionsPlaceholder,
} from "./FormOverview";
import { LifecycleDialog } from "./LifecycleDialog";

const ID = "00000001-0000-4000-8000-000000000001";
const CSRF = "csrf-token-1";

function overview(patch: Partial<Overview> = {}, form: Partial<Overview["form"]> = {}): Overview {
  return {
    form: {
      id: ID,
      slug: "spring-stories",
      title: { en: "Spring stories", es: "Historias de primavera" },
      languages: "bilingual",
      status: "published",
      settings: {
        notificationRecipients: [],
        notificationCadence: "per_submission",
        digestHour: 9,
        timezone: "America/Panama",
        referencePrefix: "SS",
        retentionMonths: 24,
        opensAt: "2026-10-01T14:00:00.000Z",
        closesAt: "2026-10-13T04:59:00.000Z",
        botChallenge: false,
        allowAnotherResponse: false,
      },
      currentVersionId: "00000009-0000-4000-8000-000000000009",
      currentVersionNumber: 2,
      archivedAt: null,
      createdAt: new Date("2026-09-01T12:00:00Z"),
      updatedAt: new Date("2026-10-01T12:00:00Z"),
      ...form,
    },
    publicUrl: "https://forms.example.com/f/spring-stories",
    summary: { total: 4, lastReceivedAt: new Date("2026-10-09T14:30:00Z") },
    reachability: { reachable: true },
    closingInDays: 3,
    canDelete: false,
    allowedActions: ["close", "archive"],
    ...patch,
  };
}

type Props = Parameters<typeof FormOverview>[0];

function render(props: Partial<Omit<Props, "children">> = {}): string {
  return renderToStaticMarkup(
    createElement(FormOverview, {
      overview: overview(),
      csrfToken: CSRF,
      tab: "submissions",
      ...props,
      children: createElement("p", { id: "tab-body" }, "Body"),
    }),
  );
}

/** The opening tags of every `element` carrying all of `attrs`, in any attribute order. */
const tags = (html: string, element: string, ...attrs: string[]) =>
  (html.match(new RegExp(`<${element}\\b[^>]*>`, "g")) ?? []).filter((tag) =>
    attrs.every((attr) => tag.includes(attr)),
  );
/** The text of each date moment as rendered: markup removed, whitespace kept. */
const moments = (html: string) =>
  [
    ...html.matchAll(
      /<span class="[^"]*moment[^"]*">(<time.*?<\/time>(?: <span[^>]*>.*?<\/span>)?)<\/span>/g,
    ),
  ].map((m) => (m[1] ?? "").replace(/<[^>]+>/g, ""));
const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]?.replaceAll("&amp;", "&"));

describe("FormOverview", () => {
  it("renders the title as the page heading", () => {
    expect(render()).toMatch(
      /<h1[^>]*>Spring stories<span lang="es"[^>]*>Historias de primavera<\/span><\/h1>/,
    );
  });

  it("shows the status badge with its version", () => {
    expect(render()).toContain("Published v2");
    const closed = render({
      overview: overview({ allowedActions: ["reopen", "archive"] }, { status: "closed" }),
    });
    expect(closed).toContain("Closed");
    expect(closed).toContain("v2");
  });

  it("shows the public URL in a read-only input labelled as the public link", () => {
    const html = render();
    const [input] = tags(html, "input", 'value="https://forms.example.com/f/spring-stories"');
    // HTML attribute names are case-insensitive; React writes `readOnly`.
    expect(input?.toLowerCase()).toContain("readonly");
    const id = input?.match(/id="([^"]+)"/)?.[1] ?? "missing";
    expect(html).toMatch(new RegExp(`<label[^>]*for="${id}"[^>]*>Public link`));
    expect(html).toContain("Select the link and copy it.");
  });

  it("shows the language mode and the dates in the form's time zone and in UTC", () => {
    const html = render();
    expect(html).toContain("English and Spanish");
    expect(html).toContain("Opens");
    expect(html).toContain("Closes");
    expect(moments(html)).toEqual([
      "2026-10-01 09:00 America/Panama 2026-10-01 14:00 UTC",
      "2026-10-12 23:59 America/Panama 2026-10-13 04:59 UTC",
    ]);
  });

  it("shows UTC once for a form kept in UTC", () => {
    const settings = { ...overview().form.settings, timezone: "UTC" };
    const html = render({ overview: overview({}, { settings }) });
    expect(moments(html)).toEqual(["2026-10-01 14:00 UTC", "2026-10-13 04:59 UTC"]);
  });

  it("notes when the form closes within seven days", () => {
    expect(render()).toContain("Closing in 3 days");
    expect(render({ overview: overview({ closingInDays: null }) })).not.toContain("Closing in");
  });

  it("leaves the dates out when none are set", () => {
    const settings = { ...overview().form.settings };
    delete settings.opensAt;
    delete settings.closesAt;
    const html = render({ overview: overview({ closingInDays: null }, { settings }) });
    expect(html).not.toContain("Opens");
    expect(html).not.toContain(" UTC");
  });

  it("links to the builder and the share tab", () => {
    const links = hrefs(render());
    expect(links).toContain(`/admin/forms/${ID}/edit`);
    expect(links).toContain(`/admin/forms/${ID}/share`);
  });

  it("offers only the allowed lifecycle actions, and Delete only when allowed", () => {
    const links = hrefs(render());
    expect(links).toContain(`/admin/forms/${ID}?action=close`);
    expect(links).toContain(`/admin/forms/${ID}?action=archive`);
    expect(links).not.toContain(`/admin/forms/${ID}?action=reopen`);
    expect(links).not.toContain(`/admin/forms/${ID}?action=unarchive`);
    expect(links).not.toContain(`/admin/forms/${ID}?action=delete`);

    const draft = render({
      overview: overview(
        { canDelete: true, allowedActions: ["archive"], closingInDays: null },
        { status: "draft", currentVersionId: null, currentVersionNumber: null },
      ),
    });
    const draftLinks = hrefs(draft);
    expect(draftLinks).toContain(`/admin/forms/${ID}?action=delete`);
    expect(draftLinks).toContain(`/admin/forms/${ID}?action=archive`);
    expect(draftLinks).not.toContain(`/admin/forms/${ID}?action=close`);
    expect(draft).toContain("Draft");
  });

  it("shows the closed banner with a way to reopen", () => {
    const html = render({
      overview: overview(
        { allowedActions: ["reopen", "archive"], closingInDays: null },
        { status: "closed" },
      ),
    });
    expect(html).toContain("This form is closed. People with the link see a closed message.");
    expect(html).toMatch(/role="status"[^]*href="\/admin\/forms\/[^"]+\?action=reopen"/);
  });

  it("shows the archived banner, and no banner for a published form", () => {
    const html = render({
      overview: overview(
        { allowedActions: ["unarchive"], closingInDays: null },
        { status: "archived", archivedAt: new Date("2026-10-05T00:00:00Z") },
      ),
    });
    expect(html).toContain("This form is archived.");
    expect(html).toMatch(/role="status"[^]*href="\/admin\/forms\/[^"]+\?action=unarchive"/);
    expect(render()).not.toContain("This form is");
  });

  it("renders the tabs with the current one marked and Submissions disabled elsewhere", () => {
    const home = render();
    expect(tags(home, "a", 'aria-current="page"', `href="/admin/forms/${ID}"`)).toHaveLength(1);
    expect(tags(home, "a", `href="/admin/forms/${ID}/settings"`)).toHaveLength(1);
    expect(tags(home, "a", `href="/admin/forms/${ID}/activity"`)).toHaveLength(1);
    expect(tags(home, "a", 'aria-disabled="true"')).toHaveLength(0);

    const settings = render({ tab: "settings" });
    expect(
      tags(settings, "a", 'aria-current="page"', `href="/admin/forms/${ID}/settings"`),
    ).toHaveLength(1);
    const disabled = tags(settings, "a", 'aria-disabled="true"');
    expect(disabled).toHaveLength(1);
    expect(disabled[0]).not.toContain("href");
  });

  it("renders the tab body as its children", () => {
    expect(render()).toContain('<p id="tab-body">Body</p>');
  });

  it("opens the confirmation of an allowed action", () => {
    const html = render({ dialog: "close" });
    expect(html).toContain('role="dialog"');
    expect(tags(html, "form", `action="/admin/forms/${ID}/lifecycle"`)).toHaveLength(1);
    expect(tags(html, "input", 'name="csrf"', `value="${CSRF}"`)).toHaveLength(1);
  });

  it("explains instead of confirming an action the form does not allow", () => {
    const html = render({ dialog: "reopen" });
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain("That action is no longer available for this form.");
  });

  it("explains a delete confirmation on a form that cannot be deleted as not allowed", () => {
    const html = render({ dialog: "delete" });
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain("This form can no longer be deleted");
    expect(html).not.toContain("That action is no longer available");
  });

  it("shows the refusals coming back from the routes as alerts", () => {
    expect(render({ error: "invalid_transition" })).toMatch(
      /role="alert"[^>]*>[^]*That action is no longer available/,
    );
    expect(render({ error: "not_allowed" })).toContain("This form can no longer be deleted");
    const mismatch = render({
      overview: overview({ canDelete: true }),
      dialog: "delete",
      error: "slug_mismatch",
    });
    expect(mismatch).toContain("The link name did not match. Nothing was deleted.");
    expect(mismatch).toContain('role="dialog"');
  });
});

describe("SubmissionsPlaceholder", () => {
  it("says review is coming and gives the count received", () => {
    const html = renderToStaticMarkup(createElement(SubmissionsPlaceholder, { total: 4 }));
    expect(html).toContain("Submission review is coming soon. Received so far: 4.");
  });
});

describe("overview query parameters", () => {
  it("accepts only known dialogs and errors", () => {
    expect(overviewDialog("close")).toBe("close");
    expect(overviewDialog("delete")).toBe("delete");
    expect(overviewDialog("publish")).toBeUndefined();
    expect(overviewDialog(["close"])).toBeUndefined();
    expect(overviewDialog(undefined)).toBeUndefined();
    expect(overviewError("invalid_transition")).toBe("invalid_transition");
    expect(overviewError("slug_mismatch")).toBe("slug_mismatch");
    expect(overviewError("not_allowed")).toBe("not_allowed");
    expect(overviewError("not_found")).toBeUndefined();
  });
});

describe("LifecycleDialog", () => {
  function dialog(action: Parameters<typeof LifecycleDialog>[0]["action"]): string {
    return renderToStaticMarkup(
      createElement(LifecycleDialog, {
        formId: ID,
        action,
        slug: "spring-stories",
        csrfToken: CSRF,
      }),
    );
  }

  it("posts a lifecycle action with the action and the token hidden", () => {
    const html = dialog("archive");
    expect(
      tags(html, "form", 'method="post"', `action="/admin/forms/${ID}/lifecycle"`),
    ).toHaveLength(1);
    expect(tags(html, "input", 'type="hidden"', 'name="action"', 'value="archive"')).toHaveLength(
      1,
    );
    expect(tags(html, "input", 'type="hidden"', 'name="csrf"', `value="${CSRF}"`)).toHaveLength(1);
    expect(html).toContain("Archive form");
    expect(html).toContain("The form closes and moves to Archived. Nothing is deleted.");
    expect(tags(html, "a", `href="/admin/forms/${ID}"`)).toHaveLength(1);
    expect(tags(html, "input", 'name="slug"')).toHaveLength(0);
  });

  it("states the effect of each action", () => {
    expect(dialog("close")).toContain("Submissions already received are kept.");
    expect(dialog("reopen")).toContain("accept submissions again");
    expect(dialog("unarchive")).toContain("The form moves back to Closed");
  });

  it("asks for the slug before deleting", () => {
    const html = dialog("delete");
    expect(tags(html, "form", `action="/admin/forms/${ID}/delete"`)).toHaveLength(1);
    expect(tags(html, "input", 'name="action"')).toHaveLength(0);
    const [input] = tags(html, "input", 'name="slug"');
    expect(input).toContain("required");
    expect(input).toContain('pattern="spring-stories"');
    expect(html).toContain(">spring-stories</code>");
    expect(html).toContain("Delete form");
    expect(html).toContain("Link name");
  });
});

describe("BuilderPlaceholder", () => {
  it("names the form, says the builder is coming and links to Settings and Share", () => {
    const html = renderToStaticMarkup(
      createElement(BuilderPlaceholder, {
        formId: ID,
        title: { en: "Spring stories", es: "Historias de primavera" },
        slug: "spring-stories",
      }),
    );
    expect(html).toMatch(/<h1[^>]*>Spring stories<span lang="es"/);
    expect(html).toContain("The builder is coming soon. Settings and sharing already work.");
    expect(hrefs(html)).toEqual(
      expect.arrayContaining([`/admin/forms/${ID}/settings`, `/admin/forms/${ID}/share`]),
    );
  });
});
