import { describe, expect, it } from "vitest";
import type { QueueAction, Row } from "./upload-queue";
import { createRowActions, reannouncing, rowButtons, type RowActionDeps } from "./upload-rows";

function row(over: Partial<Row> = {}): Row {
  return {
    localId: "f_photos-new-1",
    id: null,
    name: "photo.jpg",
    size: "12 kB",
    kind: "image",
    thumb: null,
    state: { status: "uploading", percent: 40 },
    ...over,
  };
}

/** Every effect a row action has, recorded in order. */
function harness(removeAnswer: "gone" | "failed" = "gone") {
  const log: string[] = [];
  const dispatched: QueueAction[] = [];
  const files = new Map<string, File>([
    ["f_photos-new-1", new File(["x"], "photo.jpg", { type: "image/jpeg" })],
  ]);
  const deps: RowActionDeps = {
    dispatch: (action) => {
      dispatched.push(action);
      log.push(`dispatch:${action.type}`);
    },
    fileFor: (localId) => files.get(localId),
    forgetFile: (localId) => {
      files.delete(localId);
      log.push(`forget:${localId}`);
    },
    start: (localId) => log.push(`start:${localId}`),
    cancel: (localId) => log.push(`cancel:${localId}`),
    removeStaged: (id) => {
      log.push(`delete:${id}`);
      return Promise.resolve(removeAnswer);
    },
    focusControl: () => log.push("focus"),
    revoke: (url) => log.push(`revoke:${url}`),
    announce: (text) => log.push(`announce:${text}`),
    alert: (text) => log.push(`alert:${text}`),
    removeFailed: (localId, message) => log.push(`removeFailed:${localId}:${message ?? "-"}`),
    text: {
      removed: "{file} removed",
      removeFailed: "{file} was not removed. Check your connection and try again",
    },
  };
  return { log, dispatched, files, actions: createRowActions(deps) };
}

describe("row actions", () => {
  it("Retry starts the upload again and moves focus to the file input, since its button goes away", () => {
    const { log, actions } = harness();
    actions.retry(row({ state: { status: "failed", message: "photo.jpg did not upload." } }));
    expect(log).toEqual(["dispatch:retry", "start:f_photos-new-1", "focus"]);
  });

  it("Retry does nothing for a row whose file is no longer in memory", () => {
    const { log, actions } = harness();
    actions.retry(row({ localId: "f_photos-new-9", state: { status: "failed", message: "x" } }));
    expect(log).toEqual([]);
  });

  it("Remove on an uploading row cancels its request and removes the row, with no DELETE", async () => {
    const { log, actions } = harness();
    await actions.remove(row({ thumb: "blob:thumb-1" }));
    expect(log).toEqual([
      "cancel:f_photos-new-1",
      "removeFailed:f_photos-new-1:-",
      "revoke:blob:thumb-1",
      "forget:f_photos-new-1",
      "dispatch:remove",
      "announce:photo.jpg removed",
      "focus",
    ]);
  });

  it("Remove on an uploaded row deletes it from staging first", async () => {
    const { log, actions } = harness();
    await actions.remove(row({ id: "srv-1", state: { status: "uploaded" } }));
    expect(log[0]).toBe("delete:srv-1");
    expect(log).toContain("dispatch:remove");
    expect(log).not.toContain("cancel:f_photos-new-1");
  });

  it("a failed removal keeps the row and says why, every time", async () => {
    const { log, actions } = harness("failed");
    const uploaded = row({ id: "srv-1", state: { status: "uploaded" } });
    await actions.remove(uploaded);
    const message = "photo.jpg was not removed. Check your connection and try again";
    expect(log).toEqual([
      "delete:srv-1",
      `removeFailed:f_photos-new-1:${message}`,
      `alert:${message}`,
    ]);
    await actions.remove(uploaded);
    expect(log.filter((entry) => entry === `alert:${message}`)).toHaveLength(2);
  });
});

describe("the buttons of an enhanced row", () => {
  it("are Remove for an uploading or uploaded row, and Retry then Remove for a failed one whose file is kept", () => {
    expect(rowButtons(row(), true)).toEqual(["remove"]);
    expect(rowButtons(row({ state: { status: "uploaded" } }), false)).toEqual(["remove"]);
    const failed = row({ state: { status: "failed", message: "x" } });
    expect(rowButtons(failed, true)).toEqual(["retry", "remove"]);
    expect(rowButtons(failed, false)).toEqual(["remove"]);
  });
});

describe("reannouncing", () => {
  it("clears the region, then writes the text on the next frame, so a repeated message is heard again", () => {
    const writes: string[] = [];
    const frames: (() => void)[] = [];
    const say = reannouncing(
      (text) => writes.push(text),
      (run) => frames.push(run),
    );
    say("photo.jpg did not upload.");
    expect(writes).toEqual([""]);
    frames.shift()?.();
    say("photo.jpg did not upload.");
    frames.shift()?.();
    expect(writes).toEqual(["", "photo.jpg did not upload.", "", "photo.jpg did not upload."]);
  });

  it("keeps only the latest of two messages sent within one frame", () => {
    const writes: string[] = [];
    const frames: (() => void)[] = [];
    const say = reannouncing(
      (text) => writes.push(text),
      (run) => frames.push(run),
    );
    say("first");
    say("second");
    for (const run of frames.splice(0)) run();
    expect(writes).toEqual(["", "", "second"]);
  });
});
