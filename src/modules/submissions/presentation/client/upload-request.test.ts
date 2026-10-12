import { beforeEach, describe, expect, it } from "vitest";
import { holdsPosts, inFlight, queuePost, recordStateFor } from "./bus";
import {
  removeFile,
  sendUpload,
  type UploadOutcome,
  uploadTimeoutMs,
  type XhrLike,
} from "./upload-request";

interface Progress {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

/** A request that only records what it was given, answered by the test. */
class FakeXhr {
  status = 0;
  responseText = "";
  url: string | null = null;
  body: FormData | null = null;
  upload: { onprogress: ((event: Progress) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  timeout = 0;
  aborted = 0;
  abort(): void {
    this.aborted += 1;
    this.onabort?.();
  }
  open(_method: string, url: string): void {
    this.url = url;
  }
  send(body: FormData): void {
    this.body = body;
  }
  answer(status: number, json: unknown): void {
    this.status = status;
    this.responseText = JSON.stringify(json);
    this.onload?.();
  }
}

/** The page's render time, as its form's `_rendered` input carries it. */
const RENDERED = "2026-10-10T09:00:00.000Z";

const created = {
  ok: true,
  file: { id: "srv-1", kind: "image", size: 12 },
  label: "File 1, 12 kB",
  count: 1,
};

let renders = 0;
const nextRender = (): string => {
  renders += 1;
  return `render-${String(renders)}`;
};

function harness(hasRecord: boolean) {
  recordStateFor(nextRender(), hasRecord);
  const sent: FakeXhr[] = [];
  const outcomes: UploadOutcome[] = [];
  const make = (): XhrLike => {
    const xhr = new FakeXhr();
    sent.push(xhr);
    return xhr;
  };
  const choose = (fieldKey: string, name = "photo.jpg", locale: "en" | "es" = "en"): void => {
    sendUpload(
      {
        slug: "story-form",
        fieldKey,
        locale,
        renderedAt: RENDERED,
        file: new File(["x"], name, { type: "image/jpeg" }),
      },
      { progress: () => undefined, settled: (outcome) => outcomes.push(outcome) },
      make,
    );
  };
  return { sent, outcomes, choose, make };
}

/** The requests whose body has left (open and send were called). */
const left = (sent: readonly FakeXhr[]): FakeXhr[] => sent.filter((xhr) => xhr.body !== null);

beforeEach(() => {
  // Every test starts from a fresh server render, so another test's held requests are dropped.
  recordStateFor(nextRender(), true);
});

describe("uploads before the in-progress record exists", () => {
  it("sends the first of three files chosen at once alone, and the others after it answers", () => {
    const { sent, outcomes, choose } = harness(false);
    choose("f_photos", "a.jpg");
    choose("f_photos", "b.jpg");
    choose("f_photos", "c.jpg");
    expect(left(sent)).toHaveLength(1);
    // Every chosen file counts as in flight, so Next and Submit wait for the held ones too.
    expect(inFlight()).toBe(3);
    sent[0]?.answer(200, created);
    expect(left(sent)).toHaveLength(3);
    expect(outcomes).toEqual([{ ok: true, id: "srv-1", label: "File 1, 12 kB" }]);
    sent[1]?.answer(200, created);
    sent[2]?.answer(200, created);
    expect(inFlight()).toBe(0);
  });

  it("holds an upload of a second field behind the first field's upload", () => {
    const { sent, choose } = harness(false);
    choose("f_photos");
    choose("f_videos");
    expect(left(sent).map((xhr) => xhr.body?.get("field"))).toEqual(["f_photos"]);
    sent[0]?.answer(200, created);
    expect(left(sent).map((xhr) => xhr.body?.get("field"))).toEqual(["f_photos", "f_videos"]);
    sent[1]?.answer(200, created);
  });

  it("holds a language switch pressed during the first upload until that upload answers", () => {
    const { sent, choose } = harness(false);
    expect(holdsPosts()).toBe(false);
    choose("f_photos");
    expect(holdsPosts()).toBe(true);
    const posted: string[] = [];
    queuePost(
      () => posted.push("language:es"),
      () => undefined,
    );
    expect(posted).toEqual([]);
    sent[0]?.answer(200, created);
    expect(posted).toEqual(["language:es"]);
    expect(holdsPosts()).toBe(false);
  });

  it("sends the next held upload alone again when the first is refused, since no record was made", () => {
    const { sent, outcomes, choose } = harness(false);
    choose("f_photos", "a.jpg");
    choose("f_photos", "b.jpg");
    choose("f_photos", "c.jpg");
    const posted: string[] = [];
    queuePost(
      () => posted.push("back"),
      () => undefined,
    );
    sent[0]?.answer(422, { ok: false, message: "{file} is not a supported type." });
    expect(outcomes).toEqual([{ ok: false, message: "{file} is not a supported type." }]);
    expect(left(sent)).toHaveLength(2);
    expect(posted).toEqual([]);
    // A network failure leaves no known record either: the third still waits.
    sent[1]?.onerror?.();
    expect(left(sent)).toHaveLength(3);
    expect(posted).toEqual([]);
    sent[2]?.answer(200, created);
    expect(posted).toEqual(["back"]);
  });

  it("counts a retry as an upload: it waits behind the first like any other", () => {
    const { sent, choose } = harness(false);
    choose("f_photos", "a.jpg");
    choose("f_photos", "a.jpg"); // the retry of a file that failed earlier
    expect(left(sent)).toHaveLength(1);
    sent[0]?.answer(200, created);
    expect(left(sent)).toHaveLength(2);
    sent[1]?.answer(200, created);
  });

  it("drops held requests when a new server render arrives, and stops counting them", () => {
    const { sent, choose } = harness(false);
    choose("f_photos");
    choose("f_photos");
    let dropped = 0;
    queuePost(
      () => undefined,
      () => (dropped += 1),
    );
    recordStateFor(nextRender(), true);
    expect(dropped).toBe(1);
    sent[0]?.answer(200, created);
    expect(left(sent)).toHaveLength(1);
    expect(inFlight()).toBe(0);
  });
});

describe("uploads once the in-progress record exists", () => {
  it("sends every chosen file at once, and posts are never held", () => {
    const { sent, choose } = harness(true);
    choose("f_photos");
    choose("f_photos");
    choose("f_videos");
    expect(left(sent)).toHaveLength(3);
    expect(holdsPosts()).toBe(false);
    for (const xhr of sent) xhr.answer(200, created);
    expect(inFlight()).toBe(0);
  });
});

describe("the upload request", () => {
  it("posts the field, the locale and the file under the name upload, never the original name", () => {
    const { sent, choose } = harness(true);
    choose("f_photos", "IMG_0001-family.jpg");
    const xhr = sent[0];
    expect(xhr?.url).toBe("/f/story-form/files");
    expect(xhr?.body?.get("field")).toBe("f_photos");
    expect(xhr?.body?.get("_locale")).toBe("en");
    // The files route starts a record opened by an early upload at the page's render time.
    expect(xhr?.body?.get("_rendered")).toBe(RENDERED);
    const file = xhr?.body?.get("file");
    expect(file instanceof File ? file.name : null).toBe("upload");
    xhr?.answer(200, created);
  });

  it("reports progress, a server refusal's message and a transport failure, each once", () => {
    const { sent, make } = harness(true);
    const seen: number[] = [];
    const outcomes: UploadOutcome[] = [];
    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    const on = {
      progress: (percent: number) => seen.push(percent),
      settled: (outcome: UploadOutcome) => outcomes.push(outcome),
    };
    sendUpload(
      { slug: "story-form", fieldKey: "f_photos", renderedAt: RENDERED, locale: "es", file },
      on,
      make,
    );
    sendUpload(
      { slug: "story-form", fieldKey: "f_photos", renderedAt: RENDERED, locale: "es", file },
      on,
      make,
    );
    sent[0]?.upload.onprogress?.({ lengthComputable: true, loaded: 40, total: 100 });
    sent[0]?.answer(413, { ok: false, message: "{file} pesa más de 10 MB" });
    sent[1]?.onerror?.();
    sent[1]?.ontimeout?.();
    expect(seen).toEqual([40]);
    expect(outcomes).toEqual([
      { ok: false, message: "{file} pesa más de 10 MB" },
      { ok: false, message: null },
    ]);
    expect(inFlight()).toBe(0);
  });
});

describe("a stalled or cancelled upload", () => {
  const file = (bytes: number): File =>
    new File([new Uint8Array(bytes)], "a.jpg", { type: "image/jpeg" });

  it("gives every upload a timeout that grows with the file, so a stalled one fails and frees the gate", () => {
    expect(uploadTimeoutMs(0)).toBe(60_000);
    expect(uploadTimeoutMs(2_000_000)).toBe(160_000);
    const { sent, make } = harness(false);
    const outcomes: UploadOutcome[] = [];
    const on = { progress: () => undefined, settled: (o: UploadOutcome) => outcomes.push(o) };
    sendUpload(
      {
        slug: "story-form",
        fieldKey: "f_photos",
        renderedAt: RENDERED,
        locale: "en",
        file: file(10),
      },
      on,
      make,
    );
    sendUpload(
      {
        slug: "story-form",
        fieldKey: "f_photos",
        renderedAt: RENDERED,
        locale: "en",
        file: file(10),
      },
      on,
      make,
    );
    expect(sent[0]?.timeout).toBe(uploadTimeoutMs(10));
    expect(left(sent)).toHaveLength(1);
    sent[0]?.ontimeout?.();
    expect(outcomes).toEqual([{ ok: false, message: null }]);
    // The stalled first upload made no record, so the held one now goes alone.
    expect(left(sent)).toHaveLength(2);
    sent[1]?.answer(200, created);
    expect(inFlight()).toBe(0);
  });

  it("cancels an open upload: the request is aborted, nothing is reported, and the gate moves on", () => {
    const { sent, make } = harness(false);
    const outcomes: UploadOutcome[] = [];
    const on = { progress: () => undefined, settled: (o: UploadOutcome) => outcomes.push(o) };
    const first = sendUpload(
      {
        slug: "story-form",
        fieldKey: "f_photos",
        renderedAt: RENDERED,
        locale: "en",
        file: file(10),
      },
      on,
      make,
    );
    sendUpload(
      {
        slug: "story-form",
        fieldKey: "f_photos",
        renderedAt: RENDERED,
        locale: "en",
        file: file(10),
      },
      on,
      make,
    );
    const posted: string[] = [];
    queuePost(
      () => posted.push("back"),
      () => undefined,
    );
    first.cancel();
    expect(sent[0]?.aborted).toBe(1);
    expect(outcomes).toEqual([]);
    expect(left(sent)).toHaveLength(2);
    expect(inFlight()).toBe(1);
    sent[1]?.answer(200, created);
    expect(posted).toEqual(["back"]);
    expect(inFlight()).toBe(0);
    // A second cancel, or one after the answer, changes nothing.
    first.cancel();
    expect(sent[0]?.aborted).toBe(1);
  });

  it("cancels a held upload before it leaves: it is never sent and stops counting", () => {
    const { sent, make } = harness(false);
    const outcomes: UploadOutcome[] = [];
    const on = { progress: () => undefined, settled: (o: UploadOutcome) => outcomes.push(o) };
    sendUpload(
      {
        slug: "story-form",
        fieldKey: "f_photos",
        renderedAt: RENDERED,
        locale: "en",
        file: file(10),
      },
      on,
      make,
    );
    const held = sendUpload(
      {
        slug: "story-form",
        fieldKey: "f_photos",
        renderedAt: RENDERED,
        locale: "en",
        file: file(10),
      },
      on,
      make,
    );
    expect(inFlight()).toBe(2);
    held.cancel();
    expect(inFlight()).toBe(1);
    sent[0]?.answer(200, created);
    expect(sent).toHaveLength(1);
    expect(outcomes).toHaveLength(1);
    expect(inFlight()).toBe(0);
  });
});

describe("removeFile", () => {
  const answering = (status: number) => () =>
    Promise.resolve({ ok: status >= 200 && status < 300, status });

  it("counts 204 and 404 as gone, and a server error or a network failure as failed", async () => {
    await expect(removeFile("story-form", "srv-1", answering(204))).resolves.toBe("gone");
    await expect(removeFile("story-form", "srv-1", answering(404))).resolves.toBe("gone");
    await expect(removeFile("story-form", "srv-1", answering(500))).resolves.toBe("failed");
    await expect(
      removeFile("story-form", "srv-1", () => Promise.reject(new TypeError("offline"))),
    ).resolves.toBe("failed");
  });

  it("sends DELETE to the file's route", async () => {
    const calls: [string, string | undefined][] = [];
    await removeFile("story-form", "srv-1", (url, init) => {
      calls.push([url, init.method]);
      return Promise.resolve({ ok: true, status: 204 });
    });
    expect(calls).toEqual([["/f/story-form/files/srv-1", "DELETE"]]);
  });
});
