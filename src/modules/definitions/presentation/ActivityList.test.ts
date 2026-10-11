import type { AuditRecord } from "@/modules/identity/application";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { definitionsAuditActions } from "../application";
import { ActivityList, ACTIVITY_PAGE_SIZE, activityHref } from "./ActivityList";

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

  it("shows an empty row, not an empty table, when nothing matches", () => {
    const html = list({ entries: [] });
    expect(html).toContain("No activity matches.");
    expect(html).not.toContain("<table");
  });

  it("offers no CSV export yet", () => {
    expect(list()).not.toContain("Export CSV");
  });

  it("links to older entries only when the page is full, keeping the filter", () => {
    const full = Array.from({ length: ACTIVITY_PAGE_SIZE }, (_, i) =>
      record({ id: `a${String(i)}`, at: new Date(Date.UTC(2026, 9, 9, 12, 0, 60 - i)) }),
    );
    const html = list({ entries: full, filter: { action: "form_closed" } });
    const oldest = full[full.length - 1]?.at.toISOString() ?? "";
    expect(html).toContain(
      `href="${activityHref(ID, { action: "form_closed", before: oldest }).replaceAll("&", "&amp;")}"`,
    );
    expect(html).toContain("Older entries");
    expect(list()).not.toContain("Older entries");
  });
});

describe("activityHref", () => {
  it("builds the tab link with only the parts that are set", () => {
    expect(activityHref(ID, {})).toBe(`/admin/forms/${ID}/activity`);
    expect(activityHref(ID, { actorEmail: "a@example.com", action: "form_closed" })).toBe(
      `/admin/forms/${ID}/activity?actor=a%40example.com&action=form_closed`,
    );
    expect(activityHref(ID, { before: "2026-10-09T14:30:00.000Z" })).toBe(
      `/admin/forms/${ID}/activity?before=2026-10-09T14%3A30%3A00.000Z`,
    );
  });
});
