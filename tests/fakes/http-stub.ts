import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface StubRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface HttpStub {
  url: string;
  requests: StubRequest[];
  /** Queues the answer to the next unanswered request. */
  reply(status: number, body: unknown): void;
  close(): Promise<void>;
}

/** A local HTTP server for adapter tests; answers with queued replies, then 200 `{}`. */
export async function startHttpStub(): Promise<HttpStub> {
  const requests: StubRequest[] = [];
  const replies: { status: number; body: unknown }[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        headers[name] = Array.isArray(value) ? value.join(", ") : (value ?? "");
      }
      requests.push({
        method: req.method ?? "",
        path: req.url ?? "",
        headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      const next = replies.shift() ?? { status: 200, body: {} };
      res.writeHead(next.status, { "content-type": "application/json" });
      res.end(JSON.stringify(next.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    reply: (status, body) => {
      replies.push({ status, body });
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
