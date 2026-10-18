import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DayView, IsoDate, PlanItem, WeekView } from "../application";
import { PostPlanPage } from "./PostPlanPage";
import { styles } from "./styles";

const FORM_ID = "00000001-0000-4000-8000-000000000001";
const MONDAY: IsoDate = "2026-10-19";
const TODAY: IsoDate = "2026-10-21";
const CHECK_DONE = styles.checkDone ?? "";
const CHECK_MISSING = styles.checkMissing ?? "";
const CHECK_WORDS = styles.checkWords ?? "";
const DATES: IsoDate[] = [
  "2026-10-19",
  "2026-10-20",
  "2026-10-21",
  "2026-10-22",
  "2026-10-23",
  "2026-10-24",
  "2026-10-25",
];

function item(over: Partial<PlanItem> = {}): PlanItem {
  return {
    formId: FORM_ID,
    formTitle: { en: "Stories", es: "Historias" },
    reference: "HP-0042",
    label: "Ana Example",
    readiness: {
      photosChosen: true,
      photosEdited: false,
      textChecked: true,
      ready: false,
      done: 2,
    },
    postUrl: null,
    plannedOn: null,
    publishedOn: null,
    ...over,
  };
}

function day(date: IsoDate, over: Partial<DayView> = {}): DayView {
  return {
    date,
    isToday: date === TODAY,
    isPast: date < TODAY,
    planned: null,
    published: [],
    ...over,
  };
}

function week(
  over: Partial<Omit<WeekView, "days">> & { days?: Record<IsoDate, Partial<DayView>> } = {},
): WeekView {
  const { days = {}, ...rest } = over;
  return {
    monday: MONDAY,
    today: TODAY,
    previous: "2026-10-12",
    next: "2026-10-26",
    days: DATES.map((date) => day(date, days[date] ?? {})),
    formsInPlan: 1,
    ...rest,
  };
}

function render(view: WeekView, over: Partial<Parameters<typeof PostPlanPage>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(PostPlanPage, {
      week: view,
      waiting: { rows: [], total: 0 },
      pick: null,
      csrfToken: "csrf-token",
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

/** The seven day rows, in order; the last ends where the waiting section begins. */
const rows = (html: string): string[] =>
  html
    .split(/(?=<li\b[^>]*data-day=)/)
    .slice(1)
    .map((row) => row.split("<section")[0] ?? "");

describe("PostPlanPage", () => {
  it("has one h1, a breadcrumb naming the page, and week navigation", () => {
    const html = render(week());
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(english(html.slice(html.indexOf("<h1")))).toMatch(/^Post plan/);
    const crumbs = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect(crumbs.match(/<li\b/g)).toHaveLength(1);
    expect(crumbs).toContain('aria-current="page"');
    expect(english(crumbs)).toBe("Post plan");

    expect(english(html)).toContain("Week of 2026-10-19");
    expect(html).toContain("Semana del 2026-10-19");
    const link = (label: string) =>
      (html.match(new RegExp(`<a\\b[^>]*>${label}<span`, "g")) ?? []).map(
        (tag) => /href="([^"]*)"/.exec(tag)?.[1],
      );
    expect(link("Previous week")).toEqual(["/admin/plan?week=2026-10-12"]);
    expect(link("This week")).toEqual(["/admin/plan"]);
    expect(link("Next week")).toEqual(["/admin/plan?week=2026-10-26"]);
    expect(html).toContain("Semana anterior");
    expect(html).toContain("Esta semana");
    expect(html).toContain("Semana siguiente");
  });

  it("lists seven days with today marked in words", () => {
    const html = render(week());
    const days = rows(html);
    expect(days).toHaveLength(7);
    const names = [
      ["Monday", "lunes"],
      ["Tuesday", "martes"],
      ["Wednesday", "miércoles"],
      ["Thursday", "jueves"],
      ["Friday", "viernes"],
      ["Saturday", "sábado"],
      ["Sunday", "domingo"],
    ];
    days.forEach((row, i) => {
      expect(row).toContain(names[i]?.[0]);
      expect(row).toContain(names[i]?.[1]);
    });
    const today = days[2] ?? "";
    expect(english(today)).toContain("Today");
    expect(today).toContain("Hoy");
    expect(today).toContain(`aria-current="date"`);
    expect(tags(html, "li", styles.weekToday ?? "")).toHaveLength(1);
    expect(days[2]).toContain(styles.weekToday);
    for (const other of days.filter((_, i) => i !== 2)) {
      expect(english(other)).not.toContain("Today");
      expect(other).not.toContain("aria-current");
    }
  });

  it("shows a planned story with its readiness in words", () => {
    const planned = item({ plannedOn: "2026-10-20" });
    const html = render(week({ days: { "2026-10-20": { planned } } }));
    const tuesday = rows(html)[1] ?? "";
    expect(tags(tuesday, "a", `href="/admin/forms/${FORM_ID}/submissions/HP-0042"`)).toHaveLength(
      1,
    );
    const words = english(tuesday);
    expect(words).toContain("HP-0042");
    expect(words).toContain("Ana Example");
    expect(words).toContain("Stories");
    expect(tuesday).toContain("Historias");
    expect(words).toContain("Photos chosen Done");
    expect(words).toContain("Photos edited in Canva Missing");
    expect(words).toContain("Text checked Done");
    expect(words).toContain("Not ready: 2 of 3 done");
    expect(tuesday).toContain("Hecho");
    expect(tuesday).toContain("Falta");
    // The words sit inside the element that colours the state, so today's row can override it.
    expect(tuesday).toMatch(
      new RegExp(`class="[^"]*${CHECK_DONE}[^"]*"[^>]*>.*?class="${CHECK_WORDS}"`, "s"),
    );
    expect(tuesday).toMatch(
      new RegExp(
        `class="[^"]*${CHECK_MISSING}[^"]*"[^>]*>.*?class="${CHECK_WORDS}"[^>]*>Photos edited`,
        "s",
      ),
    );
  });

  it("says Ready when all three checks are done", () => {
    const planned = item({
      plannedOn: "2026-10-20",
      readiness: {
        photosChosen: true,
        photosEdited: true,
        textChecked: true,
        ready: true,
        done: 3,
      },
    });
    const tuesday = rows(render(week({ days: { "2026-10-20": { planned } } })))[1] ?? "";
    expect(english(tuesday)).toContain("Ready");
    expect(english(tuesday)).not.toContain("Not ready");
    expect(english(tuesday)).not.toContain("Missing");
  });

  it("escapes a staff-authored label and form title", () => {
    const planned = item({
      plannedOn: "2026-10-20",
      label: "<img src=x onerror=alert(1)>",
      formTitle: { en: "<b>Stories</b>", es: "Historias" },
    });
    const html = render(week({ days: { "2026-10-20": { planned } } }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("shows published stories on their day with the post link", () => {
    const published = [
      item({ reference: "HP-0040", publishedOn: "2026-10-19", postUrl: "https://example.com/p/1" }),
      item({ reference: "HP-0039", publishedOn: "2026-10-19" }),
    ];
    const planned = item({ reference: "HP-0042", plannedOn: "2026-10-19" });
    const html = render(week({ days: { "2026-10-19": { published, planned } } }));
    const monday = rows(html)[0] ?? "";
    const words = english(monday);
    expect(words.match(/Published/g)).toHaveLength(2);
    expect(monday).toContain("Publicada");
    expect(words).toContain("HP-0040");
    expect(words).toContain("HP-0039");
    expect(words).toContain("HP-0042");
    expect(words.match(/Open the post/g)).toHaveLength(1);
    const post = tags(monday, "a", 'href="https://example.com/p/1"');
    expect(post).toHaveLength(1);
    expect(post[0]).toContain('rel="noopener"');
    expect(post[0]).toContain('target="_blank"');
    expect(words).not.toContain("Nothing planned");
    expect(words).not.toContain("Pick a story");
  });

  it("gives each day a heading holding its date, so day-to-day navigation works", () => {
    const days = rows(render(week()));
    days.forEach((row, i) => {
      const heading = /<h3\b[^>]*>(.*?)<\/h3>/s.exec(row)?.[1] ?? "";
      expect(heading).toMatch(new RegExp(`<time\\b[^>]*dateTime="${DATES[i] ?? ""}"`));
    });
  });

  it("ties each Pick a story link to its day's date", () => {
    const days = rows(render(week()));
    for (const i of [2, 3, 6]) {
      const row = days[i] ?? "";
      const link = tags(row, "a", "pick=")[0] ?? "";
      const target = /aria-describedby="([^"]*)"/.exec(link)?.[1] ?? "";
      expect(target).not.toBe("");
      const time = tags(row, "time", `id="${target}"`)[0] ?? "";
      expect(time).toContain(`dateTime="${DATES[i] ?? ""}"`);
    }
  });

  it("offers Pick a story on empty days from today, and Nothing planned before", () => {
    const html = render(week());
    const days = rows(html);
    for (const past of [days[0], days[1]]) {
      expect(english(past ?? "")).toContain("Nothing planned");
      expect(past).toContain("Nada planificado");
      expect(past).not.toContain("<a");
    }
    for (const [i, date] of [
      [2, "2026-10-21"],
      [3, "2026-10-22"],
      [6, "2026-10-25"],
    ] as const) {
      const row = days[i] ?? "";
      expect(english(row)).toContain("Pick a story");
      expect(row).toContain("Elegir una historia");
      expect(tags(row, "a", `href="/admin/plan?week=2026-10-19&amp;pick=${date}"`)).toHaveLength(1);
    }
  });

  it("lists stories waiting for a date, and plans one for the picked day", () => {
    const waiting = {
      rows: [
        item({ reference: "HP-0050", label: "Ben Example" }),
        item({ reference: "HP-0049", label: null }),
      ],
      total: 7,
    };
    const html = render(week(), { waiting, pick: "2026-10-22" });
    const words = english(html);
    expect(words).toContain("Waiting for a date");
    expect(words).toContain("7 stories");
    expect(html).toContain("7 historias");
    expect(words).toContain("Choose a story for 2026-10-22.");
    expect(html).toContain("Elige una historia para el 2026-10-22.");
    const forms = html.match(/<form\b.*?<\/form>/gs) ?? [];
    expect(forms).toHaveLength(2);
    forms.forEach((form, i) => {
      const reference = i === 0 ? "HP-0050" : "HP-0049";
      expect(form).toContain('method="post"');
      expect(form).toContain(`action="/admin/forms/${FORM_ID}/submissions/${reference}/plan"`);
      expect(form).toContain('name="csrf" value="csrf-token"');
      expect(form).toContain('name="date" value="2026-10-22"');
      expect(form).toContain('name="return" value="plan"');
      expect(form).not.toContain('name="back"');
      expect(form).toContain('name="week" value="2026-10-19"');
      expect(english(form)).toBe("Plan for 2026-10-22");
      expect(form).toContain("Planificar para el 2026-10-22");
    });
    expect(words).toContain("Ben Example");
    expect(words).toContain("No answer");
  });

  it("does not offer a plan button without a picked day", () => {
    const waiting = { rows: [item({ reference: "HP-0050" })], total: 1 };
    const html = render(week(), { waiting });
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(english(html)).toContain("1 story");
    expect(english(html)).not.toContain("Choose a story");
    expect(english(html)).toContain("HP-0050");
  });

  it("says when nothing waits for a date", () => {
    const html = render(week());
    expect(english(html)).toContain("No stories are waiting for a date.");
    expect(html).toContain("No hay historias esperando fecha.");
  });

  it("says when no form uses the plan", () => {
    const html = render(week({ formsInPlan: 0 }));
    expect(english(html)).toContain(
      "No form uses the post plan yet. Turn it on in a form's Settings.",
    );
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain("data-day=");
  });
});
