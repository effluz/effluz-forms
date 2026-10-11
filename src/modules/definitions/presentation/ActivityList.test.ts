import type { AuditRecord } from "@/modules/identity/application";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { definitionsAuditActions } from "../application";
import { ActivityList, activityHref } from "./ActivityList";

const ID = "00000001-0000-4000-8000-000000000001";

function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: "a1",
    action: "form_published",
    actorEmail: "staff.member@example.com",
    targetId: ID,
    ip: "203.0.113.7",
    details: null,
    at: new Date("2026-10-09T14:30:00Z"),
    ...overrides,
  };
}

function list(props: Partial<Parameters<typeof ActivityList>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ActivityList, {
      formId: ID,
      entries: [record()],
      actors: ["other.member@example.com", "staff.member@example.com"],
      filter: {},
      hasMore: false,
      ...props,
    }),
  );
}

/** The opening tags of every `element` carrying all of `attrs`, in any attribute order. */
const tags = (html: string, element: string, ...attrs: string[]) =>
  (html.match(new RegExp(`<${element}\\b[^>]*>`, "g")) ?? []).filter((tag) =>
    attrs.every((attr) => tag.includes(attr)),
  );

describe("ActivityList", () => {
  it("is a section with its own heading", () => {
    const html = list();
    expect(html).toMatch(/^<section\b/);
    expect(html).toMatch(/<h2\b[^>]*>Activity/);
  });

  it("filters with a plain GET form to the activity tab", () => {
    const html = list();
    expect(tags(html, "form", 'method="get"', `action="/admin/forms/${ID}/activity"`)).toHaveLength(
      1,
    );
    expect(tags(html, "select", 'name="actor"')).toHaveLength(1);
    expect(tags(html, "select", 'name="action"')).toHaveLength(1);
    expect(html).toMatch(/<label[^>]*for="activity-actor"/);
    expect(html).toMatch(/<label[^>]*for="activity-action"/);
  });

  it("offers every actor and all eleven definitions actions, with plain labels", () => {
    const html = list();
    expect(html).toContain('<option value="other.member@example.com">');
    expect(tags(html, "option", 'value="staff.member@example.com"')).toHaveLength(1);
    for (const action of definitionsAuditActions) {
      expect(tags(html, "option", `value="${action}"`), action).toHaveLength(1);
    }
    expect(definitionsAuditActions).toHaveLength(11);
    expect(html).toContain("Form published");
    expect(html).toContain("Formulario publicado");
    expect(html).toContain("Retention shortened");
    expect(tags(html, "option", 'value=""')).toHaveLength(2);
  });

  it("selects the current filter", () => {
    const html = list({
      filter: { actorEmail: "staff.member@example.com", action: "form_closed" },
    });
    expect(tags(html, "option", 'value="staff.member@example.com"', "selected")).toHaveLength(1);
    expect(tags(html, "option", 'value="form_closed"', "selected")).toHaveLength(1);
    expect(tags(html, "option", "selected")).toHaveLength(2);
  });

  it("shows a row per entry with the time in UTC, the actor, the action and the target", () => {
    const html = list({
      entries: [
        record(),
        record({
          id: "a2",
          action: "form_settings_changed",
          actorEmail: "other.member@example.com",
          details: { keys: "retentionMonths,slug" },
          at: new Date("2026-10-08T01:05:00Z"),
        }),
      ],
    });
    expect(html).toContain('dateTime="2026-10-09T14:30:00.000Z"');
    expect(html).toContain("2026-10-09 14:30 UTC");
    expect(html).toContain("2026-10-08 01:05 UTC");
    expect(html).toContain("staff.member@example.com");
    expect(html).toContain("Form published");
    expect(html).toContain("Settings changed");
    expect(html).toContain("keys: retentionMonths,slug");
    expect(tags(html, "a", `href="/admin/forms/${ID}"`).length).toBeGreaterThan(0);
    expect(html).toContain("When");
    expect(html).toContain("Who");
    expect(html).toContain("What");
    expect((html.match(/<tbody>.*<\/tbody>/s)?.[0].match(/<tr\b/g) ?? []).length).toBe(2);
  });

  it("names the system as the actor of an entry without one", () => {
    expect(list({ entries: [record({ actorEmail: null })] })).toContain("System");
  });

  it("shows an action of another module as it is stored", () => {
    expect(list({ entries: [record({ action: "submission_exported" })] })).toContain(
      "submission_exported",
    );
  });

  it("escapes stored text", () => {
    const html = list({ entries: [record({ details: { keys: "<img src=x onerror=alert(1)>" } })] });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("shows a stored object or list as JSON, not as [object Object]", () => {
    // The column is JSON; a value the writer typed as a primitive may not be one.
    const details = { changed: { retentionMonths: 24 }, keys: ["slug", "title"], none: null };
    const html = list({
      entries: [record({ details: details as unknown as Record<string, string> })],
    });
    expect(html).toContain("changed: {&quot;retentionMonths&quot;:24}");
    expect(html).toContain("keys: [&quot;slug&quot;,&quot;title&quot;]");
    expect(html).toContain("none: null");
    expect(html).not.toContain("[object Object]");
  });

  it("shows an empty row, not an empty table, when nothing matches", () => {
    const html = list({ entries: [] });
    expect(html).toContain("No activity matches.");
    expect(html).not.toContain("<table");
  });

  it("offers no CSV export yet", () => {
    expect(list()).not.toContain("Export CSV");
  });

  it("links to older entries only when more exist, with the cursor of the last row and the filter", () => {
    const entries = [
      record({ id: "a1", at: new Date("2026-10-09T12:00:00.123Z") }),
      record({ id: "a2", at: new Date("2026-10-09T11:00:00.456Z") }),
    ];
    const html = list({ entries, hasMore: true, filter: { action: "form_closed" } });
    expect(html).toContain(
      `href="${activityHref(ID, {
        action: "form_closed",
        before: "2026-10-09T11:00:00.456Z",
        beforeId: "a2",
      }).replaceAll("&", "&amp;")}"`,
    );
    expect(html).toContain("before=2026-10-09T11%3A00%3A00.456Z&amp;beforeId=a2");
    expect(html).toContain("Older entries");
    expect(list({ entries })).not.toContain("Older entries");
    expect(list({ entries: [], hasMore: true })).not.toContain("Older entries");
  });

  it("adds an actor missing from the list so the select reflects the active filter", () => {
    const html = list({ filter: { actorEmail: "gone.member@example.com" } });
    expect(tags(html, "option", 'value="gone.member@example.com"', "selected")).toHaveLength(1);
    expect(tags(html, "option", "selected")).toHaveLength(2);
    expect(tags(list(), "option", 'value="gone.member@example.com"')).toHaveLength(0);
  });

  it("adds an action of another module so the select reflects the active filter", () => {
    const html = list({ filter: { action: "submission_exported" } });
    const option = tags(html, "option", 'value="submission_exported"', "selected");
    expect(option).toHaveLength(1);
    expect(html).toContain(">submission_exported</option>");
    expect(tags(html, "option", "selected")).toHaveLength(2);
  });

  it("does not duplicate a filter value that is already an option", () => {
    const html = list({
      filter: { actorEmail: "staff.member@example.com", action: "form_closed" },
    });
    expect(tags(html, "option", 'value="staff.member@example.com"')).toHaveLength(1);
    expect(tags(html, "option", 'value="form_closed"')).toHaveLength(1);
  });
});

describe("activityHref", () => {
  it("builds the tab link with only the parts that are set", () => {
    expect(activityHref(ID, {})).toBe(`/admin/forms/${ID}/activity`);
    expect(activityHref(ID, { actorEmail: "a@example.com", action: "form_closed" })).toBe(
      `/admin/forms/${ID}/activity?actor=a%40example.com&action=form_closed`,
    );
    expect(activityHref(ID, { before: "2026-10-09T14:30:00.000Z", beforeId: "x1" })).toBe(
      `/admin/forms/${ID}/activity?before=2026-10-09T14%3A30%3A00.000Z&beforeId=x1`,
    );
  });
});
