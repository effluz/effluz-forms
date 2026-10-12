import { describe, expect, it } from "vitest";
import { readFormData, seeOther } from "./http";

const URL_ = "http://localhost/f/x/files";

/** A body of `bytes` bytes in 512-byte chunks, sent without a Content-Length. */
function streamOf(bytes: number): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (let sent = 0; sent < bytes; sent += 512)
        controller.enqueue(new Uint8Array(512).fill(97));
      controller.close();
    },
  });
}

const streamed = (body: ReadableStream<Uint8Array>, headers: Record<string, string>): Request =>
  new Request(URL_, { method: "POST", headers, body, duplex: "half" } as RequestInit);

describe("readFormData", () => {
  it("parses a body within the limit", async () => {
    const body = new FormData();
    body.set("a", "1");
    const form = await readFormData(new Request(URL_, { method: "POST", body }), 1024);
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("a")).toBe("1");
  });

  it("refuses by Content-Length before reading, and by counting a body without one", async () => {
    const multipart = "multipart/form-data; boundary=x";
    expect(
      await readFormData(
        streamed(streamOf(16), { "content-length": "5000", "content-type": multipart }),
        1024,
      ),
    ).toBe("too_large");
    expect(await readFormData(streamed(streamOf(2048), { "content-type": multipart }), 1024)).toBe(
      "too_large",
    );
  });

  it("calls an unparsable body malformed", async () => {
    const request = new Request(URL_, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: "garbage",
    });
    expect(await readFormData(request, 1024)).toBe("malformed");
  });
});

describe("seeOther", () => {
  it("is an uncached 303 with each cookie as its own header", () => {
    const res = seeOther("/f/x", ["a=1", "b=2"]);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/f/x");
    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
