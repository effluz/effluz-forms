import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DeadJobRow, OperationsView } from "../application";
import { OperationsPage } from "./OperationsPage";
import { storyHref } from "./list-view";
import { EMPTY_QUERY } from "../application";

const FORM_ID = "00000001-0000-4000-8000-000000000001";

function job(over: Partial<DeadJobRow> = {}): DeadJobRow {
  return {
    id: "job-1",
    type: "media.upload",
    attempts: 5,
    lastError: "upload failed: 503",
    createdAt: new Date("2026-10-18T10:00:00Z"),
    finishedAt: new Date("2026-10-18T10:30:00Z"),
    story: { formId: FORM_ID, reference: "HP-0042" },
    ...over,
  };
}

function view(over: Partial<OperationsView> = {}): OperationsView {
  return {
    heartbeatAgeSeconds: 45,
    heartbeat: "ok",
    dead: [],
    typesWithMany: [],
    ...over,
  };
}

function render(
  v: OperationsView,
  over: Partial<Parameters<typeof OperationsPage>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(OperationsPage, {
      view: v,
      csrfToken: "csrf-token",
      done: null,
      n: null,
      error: null,
      errorJob: null,
      ...over,
    }),
  );
}

/** The page as English text: the Spanish lines removed, tags dropped, spaces collapsed. */
const english = (html: string) =>
  html
    .replace(/<span lang="es"[^>]*>.*?<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const tags = (html: string, element: string, ...attrs: string[]) =>
  (html.match(new RegExp(`<${element}\\b[^>]*>`, "g")) ?? []).filter((tag) =>
    attrs.every((attr) => tag.includes(attr)),
  );

const forms = (html: string) => html.match(/<form\b.*?<\/form>/gs) ?? [];

describe("OperationsPage", () => {
  it("has one h1 and a breadcrumb naming the page", () => {
    const html = render(view());
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(english(html.slice(html.indexOf("<h1")))).toMatch(/^Operations/);
    const crumbs = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect(crumbs.match(/<li\b/g)).toHaveLength(1);
    expect(crumbs).toContain('aria-current="page"');
    expect(english(crumbs)).toBe("Operations");
  });

  it("shows the heartbeat in words and color together", () => {
    const ok = render(view());
    expect(english(ok)).toContain("Worker last seen");
    expect(english(ok)).toContain("45 seconds ago");
    expect(english(ok)).toContain("OK");
    expect(ok).toContain("Último latido del worker");
    expect(ok).toContain("hace 45 segundos");
    expect(ok).not.toContain('role="alert"');
    expect(english(ok)).not.toContain("The worker is not running");

    const never = render(view({ heartbeatAgeSeconds: null, heartbeat: "critical" }));
    expect(english(never)).toContain("Never");
    expect(english(never)).toContain("Critical");
    expect(never).toContain("Crítico");
    // No worker runbook exists yet, so the banner does not point at one.
    expect(english(never)).toContain(
      "The worker is not running. Jobs will resume when it returns.",
    );
    expect(english(never)).not.toContain("runbook");
    expect(never).not.toContain("Consulta el manual");
    expect(tags(never, "div", 'role="alert"')).toHaveLength(1);

    const slow = render(view({ heartbeatAgeSeconds: 200, heartbeat: "warning" }));
    expect(english(slow)).toContain("200 seconds ago");
    expect(english(slow)).toContain("Warning");
    expect(english(slow)).not.toContain("The worker is not running");

    expect(english(render(view({ heartbeatAgeSeconds: 1 })))).toContain("1 second ago");
  });

  it("lists dead jobs with their story", () => {
    const html = render(
      view({
        dead: [job(), job({ id: "job-2", story: null, type: "email.job_alert" })],
      }),
    );
    const header = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
    for (const column of [
      "Type",
      "Story",
      "Attempts",
      "Last error",
      "First attempt",
      "Last attempt",
    ])
      expect(english(header)).toContain(column);
    expect(tags(html, "a", `href="${storyHref(FORM_ID, "HP-0042", EMPTY_QUERY)}"`)).toHaveLength(1);
    const body = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
    const rows = body.split("<tr").slice(1);
    expect(english(rows[0] ?? "")).toContain("media.upload");
    expect(english(rows[0] ?? "")).toContain("HP-0042");
    expect(english(rows[0] ?? "")).toContain("upload failed: 503");
    expect(english(rows[0] ?? "")).toContain("2026-10-18 10:00");
    expect(english(rows[0] ?? "")).toContain("2026-10-18 10:30");
    expect(english(rows[1] ?? "")).toContain("email.job_alert");
    expect(english(rows[1] ?? "")).toContain("No story");
    expect(rows[1]).toContain("Sin historia");
    expect(rows[1]).not.toContain("/submissions/");
    expect(english(html)).toContain("Jobs that stopped retrying");
    expect(english(html)).not.toContain("No jobs need attention.");
  });

  it("escapes an error text", () => {
    const html = render(view({ dead: [job({ lastError: "<script>alert(1)</script>" })] }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("offers Retry, Discard with a reason, and Retry all of type", () => {
    const html = render(
      view({
        dead: [job(), job({ id: "job-2" }), job({ id: "job-3", type: "email.job_alert" })],
        typesWithMany: [{ type: "media.upload", count: 2 }],
      }),
    );
    const all = forms(html);
    const retry = all.filter((f) => f.includes('action="/admin/operations/retry"'));
    expect(retry).toHaveLength(3);
    expect(retry.map((f) => /name="job" value="([^"]*)"/.exec(f)?.[1])).toEqual([
      "job-1",
      "job-2",
      "job-3",
    ]);
    for (const form of retry) {
      expect(form).toContain('method="post"');
      expect(form).toContain('name="csrf" value="csrf-token"');
      expect(english(form)).toBe("Retry");
    }

    const discard = all.filter((f) => f.includes('action="/admin/operations/discard"'));
    expect(discard).toHaveLength(3);
    for (const form of discard) {
      expect(form).toContain('method="post"');
      expect(form).toContain('name="csrf" value="csrf-token"');
      const input = tags(form, "input", 'name="reason"')[0] ?? "";
      expect(input).toContain("required");
      expect(input).toContain('pattern="\\S.*"');
      expect(input).toMatch(/maxlength="200"/i);
      const id = /id="([^"]*)"/.exec(input)?.[1] ?? "";
      expect(id).not.toBe("");
      expect(form).toMatch(new RegExp(`<label[^>]*for="${id}"[^>]*>Reason<span`));
      expect(english(form)).toContain("Discard");
    }

    const bulk = all.filter((f) => f.includes('action="/admin/operations/retry-type"'));
    expect(bulk).toHaveLength(1);
    expect(bulk[0]).toContain('name="type" value="media.upload"');
    expect(bulk[0]).toContain('name="csrf" value="csrf-token"');
    expect(english(bulk[0] ?? "")).toBe("Retry all media.upload jobs (2)");
    expect(bulk[0]).toContain("Reintentar todos los trabajos media.upload (2)");
  });

  it("gives every control a name that says which job it is for", () => {
    const html = render(view({ dead: [job(), job({ id: "job-2" })] }));
    const buttons = tags(html, "button");
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      const targets = /aria-describedby="([^"]*)"/.exec(button)?.[1] ?? "";
      expect(targets).not.toBe("");
      for (const target of targets.split(" ")) expect(html).toContain(`id="${target}"`);
    }
  });

  it("names the type and the story in each row's button descriptions", () => {
    const html = render(view({ dead: [job(), job({ id: "job-2", story: null })] }));
    const buttons = tags(html, "button");
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      const ids = (/aria-describedby="([^"]*)"/.exec(button)?.[1] ?? "").split(" ");
      expect(ids).toHaveLength(2);
      for (const id of ids) expect(html).toContain(`id="${id}"`);
    }
    const ids = (/aria-describedby="([^"]*)"/.exec(buttons[0] ?? "")?.[1] ?? "").split(" ");
    const story = tags(html, "a", `id="${ids[1] ?? ""}"`)[0] ?? "";
    expect(story).toContain("/submissions/HP-0042");
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("reports results and a refused discard at its row", () => {
    const dead = [job(), job({ id: "job-2" })];
    const retriedAll = render(view({ dead }), { done: "retried_all", n: 2 });
    expect(english(retriedAll)).toContain("2 jobs will run again shortly.");
    expect(retriedAll).toContain("2 trabajos se ejecutarán de nuevo en breve.");
    expect(english(render(view({ dead }), { done: "retried_all", n: 1 }))).toContain(
      "1 job will run again shortly.",
    );
    expect(english(render(view({ dead }), { done: "retried", n: null }))).toContain(
      "The job will run again shortly.",
    );
    expect(english(render(view({ dead }), { done: "discarded", n: null }))).toContain(
      "The job was discarded.",
    );
    expect(english(render(view({ dead })))).not.toContain("will run again");

    const refused = render(view({ dead }), { error: "reason_invalid", errorJob: "job-2" });
    const [first, second] = forms(refused).filter((f) =>
      f.includes('action="/admin/operations/discard"'),
    );
    expect(english(first ?? "")).not.toContain("Write why");
    expect(english(second ?? "")).toContain(
      "Write why you are discarding it, in at most 200 characters.",
    );
    const input = tags(second ?? "", "input", 'name="reason"')[0] ?? "";
    expect(input).toContain('aria-invalid="true"');
    const message = /aria-describedby="([^"]*)"/.exec(input)?.[1] ?? "";
    expect(second).toContain(`id="${message}"`);
    expect(first).not.toContain("aria-invalid");
    expect(english(refused).match(/Write why you are discarding it/g)).toHaveLength(1);
  });

  it("still shows a refused discard whose job is gone", () => {
    const html = render(view({ dead: [job()] }), { error: "reason_invalid", errorJob: "job-9" });
    expect(english(html).match(/Write why you are discarding it/g)).toHaveLength(1);
    expect(tags(html, "div", 'role="alert"')).toHaveLength(1);
  });

  it("says when nothing needs attention", () => {
    const html = render(view());
    expect(english(html)).toContain("No jobs need attention.");
    expect(html).toContain("Ningún trabajo necesita atención.");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<form");
  });
});
