import { describe, expect, it } from "vitest";
import { asKey, type Field, fieldTypes, type Version } from "@/shared/domain/form-model";
import { registry, storyVersion } from "../domain/testing/versions";
import { decodePagePost, parseAction } from "./decode";

function formOf(entries: Record<string, string | File | (string | File)[]>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(entries)) {
    for (const v of Array.isArray(value) ? value : [value]) form.append(name, v);
  }
  return form;
}

describe("decodePagePost", () => {
  it("reads the page's answers, control fields and files, ignoring other pages' fields and Next's own fields", async () => {
    const form = formOf({
      $ACTION_REF_1: "",
      _page: "page_contact",
      _action: "next",
      _rendered: "2026-10-10T11:59:00.000Z",
      "website-url": "",
      f_name: "Ana Prueba",
      f_baby: "yes_opt",
      f_consent: "accepted",
    });
    const post = await decodePagePost(form, storyVersion(), registry);
    expect(post).toMatchObject({
      pageKey: "page_contact",
      action: { kind: "next" },
      answers: { f_name: "Ana Prueba", f_baby: "yes_opt" },
      raw: { f_name: "Ana Prueba", f_baby: "yes_opt" },
      renderedAt: new Date("2026-10-10T11:59:00.000Z"),
      honeypot: "",
      submitToken: null,
    });
    expect(post?.answers).not.toHaveProperty("f_consent");
    expect(post?.raw).not.toHaveProperty("f_consent");
    expect(post?.raw).not.toHaveProperty("$ACTION_REF_1");
  });

  it("keeps in raw only the names the page's controls post: a key, and a date's three parts", async () => {
    const story = storyVersion();
    const date: Field = {
      key: asKey("f_due"),
      type: "date",
      label: { en: "Due date", es: "Fecha probable" },
      required: false,
      personal: false,
      validation: [],
      settings: fieldTypes.date.fixtures.settings[0],
    };
    const version: Version = {
      ...story,
      pages: story.pages.map((page) =>
        page.key === "page_contact" ? { ...page, fields: [...page.fields, date] } : page,
      ),
    };
    const form = formOf({
      _page: "page_contact",
      _action: "next",
      f_name: "Ana Prueba",
      "f_name.extra": "x".repeat(50),
      "f_due.day": "9",
      "f_due.month": "11",
      "f_due.year": "2026",
      "f_due.hour": "10",
      f_due: "stray",
    });
    const post = await decodePagePost(form, version, registry);
    expect(post?.raw).toEqual({
      f_name: "Ana Prueba",
      "f_due.day": "9",
      "f_due.month": "11",
      "f_due.year": "2026",
    });
  });

  it("collects posted files of the page's upload fields with their names", async () => {
    const form = formOf({
      _page: "page_baby",
      _action: "next",
      f_photos: [new File([new Uint8Array([1, 2])], "a.jpg"), new File([], "")],
    });
    const post = await decodePagePost(form, storyVersion(), registry);
    expect(post?.incoming.map((f) => [f.fieldKey, f.name, f.bytes.length])).toEqual([
      ["f_photos", "a.jpg", 2],
      ["f_photos", "", 0],
    ]);
  });

  it("refuses an unknown page or action", async () => {
    const unknownPage = formOf({ _page: "page_nope", _action: "next" });
    expect(await decodePagePost(unknownPage, storyVersion(), registry)).toBeNull();
    expect(parseAction("language:fr")).toBeNull();
    expect(parseAction("remove:00000000-0000-4000-8000-000000000001")).toEqual({
      kind: "remove",
      fileId: "00000000-0000-4000-8000-000000000001",
    });
    expect(parseAction("language:es")).toEqual({ kind: "language", locale: "es" });
  });
});
