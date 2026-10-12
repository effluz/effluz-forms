/**
 * A browser without script, over HTTP: it reads the page form from the HTML,
 * posts it multipart, keeps its cookies and follows no redirect on its own.
 * Synthetic data only.
 */

export interface Reply {
  status: number;
  html: string;
  location: string | null;
}

const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
};

/** Decodes the entities React and Next emit in attributes and text. */
function decode(text: string): string {
  return text.replace(/&quot;|&#x27;|&#39;|&lt;|&gt;|&amp;/g, (entity) => ENTITIES[entity] ?? "");
}

/** The attributes of one start tag, by name; a bare attribute is the empty string. */
function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
  const body = tag.replace(/^<\w+/, "").replace(/\/?>$/, "");
  for (const match of body.matchAll(pattern)) {
    const name = match[1];
    if (name === undefined) continue;
    out.set(name.toLowerCase(), decode(match[2] ?? match[3] ?? ""));
  }
  return out;
}

/** The page form: its start tag's attributes and the markup up to its end tag. */
function pageForm(html: string): { attrs: Map<string, string>; inner: string } {
  for (const match of html.matchAll(/<form\b[^>]*>/g)) {
    const attrs = attributes(match[0]);
    if (attrs.get("id") !== "page-form") continue;
    const start = match.index + match[0].length;
    const end = html.indexOf("</form>", start);
    return { attrs, inner: html.slice(start, end === -1 ? undefined : end) };
  }
  throw new Error("no page form in the HTML");
}

/** Every hidden input of a fragment, in document order. */
function hiddenInputs(fragment: string): [string, string][] {
  const out: [string, string][] = [];
  for (const match of fragment.matchAll(/<input\b[^>]*>/g)) {
    const attrs = attributes(match[0]);
    const name = attrs.get("name");
    if (attrs.get("type") !== "hidden" || name === undefined) continue;
    out.push([name, attrs.get("value") ?? ""]);
  }
  return out;
}

/** One hidden input's value anywhere in `html`, or null. */
export function hidden(html: string, name: string): string | null {
  return hiddenInputs(html).find(([n]) => n === name)?.[1] ?? null;
}

/** The visible text: no scripts, styles or tags, entities decoded, whitespace collapsed. */
export function textOf(html: string): string {
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ");
  return decode(stripped).replace(/\s+/g, " ").trim();
}

/** A visitor with one cookie jar; both renderer cookies live on `/f/<slug>`. */
export class Visitor {
  private readonly jar = new Map<string, string>();
  private readonly headers: Record<string, string>;
  private lastPath = "/";

  constructor(
    private readonly base: string,
    headers: Record<string, string> = { "accept-language": "es-PA,es;q=0.9" },
  ) {
    this.headers = headers;
  }

  async get(path: string): Promise<Reply> {
    this.lastPath = path;
    return this.send(path, { method: "GET" });
  }

  /** Posts the page form found in `html`: its hidden inputs (Next's Server Action fields included), then `fields`, then `files`. */
  async submit(
    html: string,
    fields: Record<string, string>,
    files: readonly { field: string; file: File }[] = [],
  ): Promise<Reply> {
    const { attrs, inner } = pageForm(html);
    const values = new Map<string, string>(hiddenInputs(inner));
    for (const [name, value] of Object.entries(fields)) values.set(name, value);
    const body = new FormData();
    for (const [name, value] of values) body.append(name, value);
    for (const { field, file } of files) body.append(field, file);
    // React renders a Server Action form without an action URL: it posts to the page itself.
    const action = attrs.get("action");
    const target = action === undefined || action === "" ? this.lastPath : action;
    return this.send(target, { method: "POST", body, headers: { origin: this.base } });
  }

  /** A held cookie's value, `effluz_fill` by default. */
  cookie(name = "effluz_fill"): string | null {
    return this.jar.get(name) ?? null;
  }

  private async send(
    path: string,
    init: { method: string; body?: FormData; headers?: Record<string, string> },
  ): Promise<Reply> {
    const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await fetch(new URL(path, this.base), {
      method: init.method,
      redirect: "manual",
      headers: {
        ...this.headers,
        ...init.headers,
        ...(cookie === "" ? {} : { cookie }),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    for (const line of response.headers.getSetCookie()) this.store(line);
    return {
      status: response.status,
      html: await response.text(),
      location: response.headers.get("location"),
    };
  }

  private store(line: string): void {
    const [pair = "", ...attrs] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) return;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a));
    if (value === "" || expired) this.jar.delete(name);
    else this.jar.set(name, value);
  }
}
