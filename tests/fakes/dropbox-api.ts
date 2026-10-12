import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A local fake of the slice of the Dropbox HTTP API the media adapter uses.
 * It listens on 127.0.0.1 on an ephemeral port and serves both the api and the
 * content host. Test tooling only: nothing under src/ may import it.
 */
export interface FakeDropbox {
  /** Serves both the api and the content hosts. */
  url: string;
  /** Stored files by path. */
  files: Map<string, Uint8Array>;
  /** Endpoint paths in the order they were requested. */
  calls: string[];
  /** The raw `Dropbox-API-Arg` header of every upload, as received. */
  uploadArgs: string[];
  /** How many refresh-token exchanges were answered. */
  readonly tokenRefreshes: number;
  /** The next request to a files endpoint is answered with this status, once. */
  failNext(status: number, body?: unknown): void;
  /** The next authenticated call gets 401 expired_access_token. */
  revokeTokens(): void;
  close(): Promise<void>;
}

const EXPIRED = {
  error_summary: "expired_access_token/",
  error: { ".tag": "expired_access_token" },
};

const CONFLICT = {
  error_summary: "path/conflict/file/",
  error: { ".tag": "path", path: { ".tag": "conflict", conflict: { ".tag": "file" } } },
};

const MALFORMED_PATH = {
  error_summary: "path/malformed_path/",
  error: { ".tag": "path", path: { ".tag": "malformed_path" } },
};

function notFound(summary: string): unknown {
  return {
    error_summary: summary,
    error: { ".tag": "path", path: { ".tag": "not_found" } },
  };
}

async function readBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function startFakeDropbox(): Promise<FakeDropbox> {
  const files = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const uploadArgs: string[] = [];
  let refreshes = 0;
  let token = "token-0";
  const queued: Array<{ status: number; body: unknown }> = [];

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    calls.push(path);
    if (req.method !== "POST") {
      reply(res, 405, { error_summary: "method_not_allowed/" });
      return;
    }
    const body = await readBody(req);

    if (path === "/oauth2/token") {
      refreshes += 1;
      token = `token-${String(refreshes)}`;
      reply(res, 200, { access_token: token, token_type: "bearer", expires_in: 14400 });
      return;
    }

    const failure = queued.shift();
    if (failure) {
      reply(res, failure.status, failure.body);
      return;
    }

    if (req.headers.authorization !== `Bearer ${token}`) {
      reply(res, 401, EXPIRED);
      return;
    }

    if (path === "/2/files/upload") {
      const raw = String(req.headers["dropbox-api-arg"] ?? "{}");
      uploadArgs.push(raw);
      const arg = JSON.parse(raw) as { path?: string; mode?: string };
      const target = arg.path ?? "";
      if (!target.startsWith("/")) {
        reply(res, 409, MALFORMED_PATH);
        return;
      }
      // Real Dropbox defaults to `add`, which refuses to replace a file.
      if (files.has(target) && arg.mode !== "overwrite") {
        reply(res, 409, CONFLICT);
        return;
      }
      files.set(target, body);
      reply(res, 200, { id: "id:fake", path_lower: target.toLowerCase(), size: body.byteLength });
      return;
    }

    if (
      path === "/2/files/get_metadata" ||
      path === "/2/files/get_temporary_link" ||
      path === "/2/files/delete_v2"
    ) {
      const target = (JSON.parse(Buffer.from(body).toString("utf8")) as { path: string }).path;
      if (!target.startsWith("/")) {
        reply(res, 409, MALFORMED_PATH);
        return;
      }
      const exists = files.has(target);
      if (path === "/2/files/delete_v2") {
        if (!exists) {
          reply(res, 409, notFound("path_lookup/not_found/"));
        } else {
          files.delete(target);
          reply(res, 200, { metadata: { path_lower: target.toLowerCase() } });
        }
      } else if (!exists) {
        reply(res, 409, notFound("path/not_found/"));
      } else if (path === "/2/files/get_metadata") {
        reply(res, 200, { ".tag": "file", path_lower: target.toLowerCase() });
      } else {
        reply(res, 200, { link: `https://dl.example.com${target}` });
      }
      return;
    }

    reply(res, 404, { error_summary: "not_found/" });
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) reply(res, 500, { error_summary: "fake_failure/" });
      else res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    files,
    calls,
    uploadArgs,
    get tokenRefreshes() {
      return refreshes;
    },
    failNext(status, failBody = { error_summary: "too_many_requests/" }) {
      queued.push({ status, body: failBody });
    },
    revokeTokens() {
      token = "revoked";
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((e) => {
          if (e) reject(e);
          else resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}
