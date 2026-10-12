import type { MediaStorage } from "../application/ports/media-storage";

export interface DropboxConfig {
  appKey: string;
  appSecret: string;
  refreshToken: string;
  /** https://api.dropboxapi.com */
  apiUrl: string;
  /** https://content.dropboxapi.com */
  contentUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** A Dropbox call that did not succeed. The message carries the endpoint and status only. */
export class DropboxRequestError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
  ) {
    super(`dropbox ${endpoint} failed with ${String(status)}`);
    this.name = "DropboxRequestError";
  }
}

const TOKEN_ENDPOINT = "oauth2/token";
/**
 * Every Dropbox call stops waiting after this long, so a hung connection
 * becomes a failed attempt the job system retries instead of a job that holds
 * its lease. Sized for the largest upload (10 MB) on a slow link.
 */
const REQUEST_TIMEOUT_MS = 60_000;
const TOKEN_MARGIN_MS = 60_000;
/** Temporary links last four hours; cache for five minutes less. */
const LINK_MAX_CACHE_SECONDS = 4 * 3600 - 5 * 60;

interface CachedToken {
  value: string;
  expiresAt: number;
}

interface CachedLink {
  url: string;
  expiresAt: number;
}

/** Header values must be ASCII, so every character above U+007E is written as a JSON escape. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Durable media storage in a Dropbox App folder, reached with a refresh token
 * through plain `fetch` (ADR 0002). Rate limits and server errors throw so the
 * job system retries; nothing retries inline except the single token renewal
 * after a 401. See specs/system/media-storage.md, "Adapters".
 */
export class DropboxStorage implements MediaStorage {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private token: CachedToken | null = null;
  private refreshing: Promise<string> | null = null;
  private readonly links = new Map<string, CachedLink>();

  constructor(private readonly config: DropboxConfig) {
    this.fetchImpl = config.fetch ?? fetch;
    this.now = config.now ?? Date.now;
  }

  /** The content type is not sent: Dropbox stores the bytes as received. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the port
  async put(bytes: Uint8Array, key: string, _contentType: string): Promise<string> {
    const path = this.refForKey(key);
    const res = await this.send(
      "files/upload",
      this.config.contentUrl,
      {
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": asciiJson({ path, mode: "overwrite", mute: true }),
      },
      // Dropbox takes the raw bytes; the cast only bridges the DOM and Node typings.
      bytes as BodyInit,
    );
    await res.body?.cancel();
    return path;
  }

  refForKey(key: string): string {
    return `/${key}`;
  }

  async exists(ref: string): Promise<boolean> {
    const res = await this.sendJson("files/get_metadata", { path: ref }, true);
    await res.body?.cancel();
    return res.ok;
  }

  async delete(ref: string): Promise<void> {
    this.links.delete(ref);
    const res = await this.sendJson("files/delete_v2", { path: ref }, true);
    await res.body?.cancel();
  }

  async viewUrl(ref: string, ttlSeconds: number): Promise<string> {
    const cached = this.links.get(ref);
    if (cached && cached.expiresAt > this.now()) return cached.url;
    const res = await this.sendJson("files/get_temporary_link", { path: ref }, false);
    const { link } = (await res.json()) as { link: string };
    const cacheSeconds = Math.min(ttlSeconds, LINK_MAX_CACHE_SECONDS);
    this.links.set(ref, { url: link, expiresAt: this.now() + cacheSeconds * 1000 });
    return link;
  }

  private sendJson(endpoint: string, body: unknown, tolerateNotFound: boolean): Promise<Response> {
    return this.send(
      endpoint,
      this.config.apiUrl,
      { "Content-Type": "application/json" },
      JSON.stringify(body),
      tolerateNotFound,
    );
  }

  /**
   * Posts to `<base>/2/<endpoint>` with the access token. A 401 discards the
   * token and retries once. A 409 `not_found` is returned to the caller when
   * `tolerateNotFound` is set; any other non-2xx throws.
   */
  private async send(
    endpoint: string,
    base: string,
    headers: Record<string, string>,
    body: BodyInit,
    tolerateNotFound = false,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const token = await this.accessToken();
      const res = await this.fetchImpl(`${base}/2/${endpoint}`, {
        method: "POST",
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return res;
      if (res.status === 401 && attempt === 0) {
        await res.body?.cancel();
        this.token = null;
        continue;
      }
      if (res.status === 409 && tolerateNotFound) {
        const text = await res.text();
        if (text.includes("not_found")) return new Response(null, { status: 409 });
        throw new DropboxRequestError(endpoint, res.status);
      }
      await res.body?.cancel();
      throw new DropboxRequestError(endpoint, res.status);
    }
  }

  private accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return Promise.resolve(this.token.value);
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    const res = await this.fetchImpl(`${this.config.apiUrl}/${TOKEN_ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.config.refreshToken,
        client_id: this.config.appKey,
        client_secret: this.config.appSecret,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new DropboxRequestError(TOKEN_ENDPOINT, res.status);
    }
    const { access_token, expires_in } = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = {
      value: access_token,
      expiresAt: this.now() + expires_in * 1000 - TOKEN_MARGIN_MS,
    };
    return access_token;
  }
}
