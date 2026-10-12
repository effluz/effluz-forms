import { LIMITS } from "@/shared/domain/form-model";

/*
 * Body reading and responses for the renderer's route handlers. A body is
 * refused past its limit without being buffered whole; see
 * specs/system/security.md, "Public form abuse protection" (upload limits).
 */

/** One file of the largest size a field may take, plus room for the other parts. */
export const FILE_BODY_LIMIT = LIMITS.fileSizeMb * 1024 * 1024 + 64 * 1024;

/**
 * The posted form, or why there is none: `too_large` when the declared length or the bytes
 * actually sent pass `maxBytes`, `malformed` when the body does not parse.
 */
export async function readFormData(
  request: Request,
  maxBytes: number,
): Promise<FormData | "too_large" | "malformed"> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) return "too_large";
  const contentType = request.headers.get("content-type") ?? "";
  // An object, so the check after the parse sees what the stream wrote.
  const counter = { bytes: 0, tripped: false };
  const limited = request.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        counter.bytes += chunk.byteLength;
        if (counter.bytes > maxBytes) {
          counter.tripped = true;
          controller.error(new RangeError("body too large"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  try {
    return await new Response(limited ?? null, {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    return counter.tripped ? "too_large" : "malformed";
  }
}

function headersWith(cookies: readonly string[]): Headers {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}

/** An uncached 303 to `location`, each cookie as its own `Set-Cookie`. */
export function seeOther(location: string, cookies: readonly string[] = []): Response {
  const headers = headersWith(cookies);
  headers.set("Location", location);
  return new Response(null, { status: 303, headers });
}

/** An uncached JSON answer. */
export function json(body: unknown, status = 200, cookies: readonly string[] = []): Response {
  const headers = headersWith(cookies);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

/** An uncached answer with no body. */
export function plain(status: number): Response {
  return new Response(null, { status, headers: headersWith([]) });
}
