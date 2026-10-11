import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FormOverview as Overview } from "../application";
import { ActivityList } from "./ActivityList";
import { FormOverview, type OverviewTab } from "./FormOverview";
import { SettingsForm } from "./SettingsForm";
import { SharePanel } from "./SharePanel";

const ID = "00000001-0000-4000-8000-000000000001";

const overview: Overview = {
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
  },
  publicUrl: "https://forms.example.com/f/spring-stories",
  summary: { total: 0, lastReceivedAt: null },
  reachability: { reachable: true },
  closingInDays: null,
  canDelete: false,
  allowedActions: ["close", "archive"],
};

/** What each tab page puts inside the overview, as the `settings`, `share` and `activity` pages do. */
const BODIES: Record<Exclude<OverviewTab, "submissions">, () => ReactNode> = {
  settings: () =>
    createElement(SettingsForm, {
      form: overview.form,
      csrfToken: "csrf-token-1",
      hasSubmissions: false,
      timezones: ["America/Panama"],
      action: `/admin/forms/${ID}/settings`,
    }),
  share: () =>
    createElement(SharePanel, {
      formId: ID,
      info: { url: overview.publicUrl, reachable: true, reason: null },
    }),
  activity: () =>
    createElement(ActivityList, {
      formId: ID,
      entries: [],
      actors: [],
      filter: {},
      hasMore: false,
    }),
};

const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe.each(["settings", "share", "activity"] as const)(
  "the %s tab inside the overview",
  (tab) => {
    const html = renderToStaticMarkup(
      createElement(FormOverview, {
        overview,
        csrfToken: "csrf-token-1",
        tab,
        children: BODIES[tab](),
      }),
    );

    it("has the form title as the only h1", () => {
      expect(count(html, /<h1\b/g)).toBe(1);
      expect(html).toMatch(/<h1\b[^>]*>[\s\S]*Spring stories/);
    });

    it("has the tab's own h2", () => {
      const label = { settings: "Settings", share: "Share", activity: "Activity" }[tab];
      expect(html).toMatch(new RegExp(`<h2\\b[^>]*>[\\s\\S]*?${label}`));
    });

    it("marks only its own tab as the current page", () => {
      const current = html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
      expect(current).toHaveLength(1);
      expect(current[0]).toContain(`href="/admin/forms/${ID}/${tab}"`);
    });

    it("has a single breadcrumb trail", () => {
      expect(count(html, /<nav\b[^>]*aria-label="[^"]*[Bb]readcrumb/g)).toBe(1);
    });
  },
);
