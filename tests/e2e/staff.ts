import type { Reply } from "./http";

/**
 * A staff member's browser without script, over HTTP: one admin session cookie, form posts
 * with the session's CSRF token, and no redirect followed on its own. See
 * specs/ui-ux/manager.md, "Routes". Synthetic data only.
 */
export class Staff {
  constructor(
    private readonly base: string,
    private readonly session: { sessionId: string; csrf: string },
    private readonly cookieName = "effluz_admin_session",
  ) {}

  async get(path: string): Promise<Reply> {
    return this.reply(await this.send(path, { method: "GET" }));
  }

  /** Posts the fields plus `csrf` (multipart when files are given); `opts.csrf` overrides the token, `opts.anonymous` sends no cookie. */
  async post(
    path: string,
    fields: Record<string, string>,
    files: readonly { field: string; file: File }[] = [],
    opts: { csrf?: string; anonymous?: boolean } = {},
  ): Promise<Reply> {
    const values: Record<string, string> = { csrf: opts.csrf ?? this.session.csrf, ...fields };
    let body: FormData | URLSearchParams;
    if (files.length > 0) {
      const form = new FormData();
      for (const [name, value] of Object.entries(values)) form.append(name, value);
      for (const { field, file } of files) form.append(field, file);
      body = form;
    } else {
      body = new URLSearchParams(values);
    }
    const response = await this.send(path, {
      method: "POST",
      body,
      anonymous: opts.anonymous === true,
    });
    return this.reply(response);
  }

  /** The response body as bytes, for CSV and ZIP downloads. */
  async download(
    path: string,
    fields?: Record<string, string>,
  ): Promise<{ status: number; headers: Headers; bytes: Uint8Array }> {
    const response =
      fields === undefined
        ? await this.send(path, { method: "GET" })
        : await this.send(path, {
            method: "POST",
            body: new URLSearchParams({ csrf: this.session.csrf, ...fields }),
          });
    return {
      status: response.status,
      headers: response.headers,
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  }

  private async send(
    path: string,
    init: { method: string; body?: FormData | URLSearchParams; anonymous?: boolean },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "accept-language": "es-PA,es;q=0.9",
      origin: this.base,
    };
    if (init.anonymous !== true) headers.cookie = `${this.cookieName}=${this.session.sessionId}`;
    return fetch(new URL(path, this.base), {
      method: init.method,
      redirect: "manual",
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    });
  }

  private async reply(response: Response): Promise<Reply> {
    return {
      status: response.status,
      html: await response.text(),
      location: response.headers.get("location"),
    };
  }
}
