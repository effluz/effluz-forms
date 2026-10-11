import { describe, expect, it } from "vitest";
import type { Form } from "../domain/form";
import { shareInfo } from "./share-info";
import { fakeUuid, makeDefinitionsDeps, seedForm } from "./testing/fakes";

const PUBLISHED = {
  status: "published",
  currentVersionId: fakeUuid(900),
  currentVersionNumber: 1,
} as const;

/** Seeds a form with `patch` and date settings; the clock reads 2026-10-10T09:00Z. */
async function share(
  patch: Partial<Omit<Form, "id">>,
  dates: { opensAt?: string; closesAt?: string } = {},
) {
  const deps = makeDefinitionsDeps();
  const formId = await seedForm(deps);
  const form = deps.store.forms.get(formId);
  if (!form) throw new Error("seeded form missing");
  deps.store.forms.set(formId, { ...form, ...patch, settings: { ...form.settings, ...dates } });
  return shareInfo(deps, formId);
}

describe("shareInfo", () => {
  it("returns null for an unknown form", async () => {
    const deps = makeDefinitionsDeps();
    expect(await shareInfo(deps, fakeUuid(404))).toBeNull();
  });

  it("gives the public URL of a reachable published form", async () => {
    expect(await share(PUBLISHED)).toEqual({
      url: "https://forms.example.com/f/sample-form",
      reachable: true,
      reason: null,
    });
  });

  it.each([
    ["draft", {}, {}],
    ["closed", { ...PUBLISHED, status: "closed" }, {}],
    ["archived", { ...PUBLISHED, status: "archived" }, {}],
    ["not_open_yet", PUBLISHED, { opensAt: "2026-10-11T00:00:00Z" }],
    ["past_close", PUBLISHED, { closesAt: "2026-10-10T08:00:00Z" }],
  ] as const)("reports %s", async (reason, patch, dates) => {
    expect(await share(patch, dates)).toEqual({
      url: "https://forms.example.com/f/sample-form",
      reachable: false,
      reason,
    });
  });
});
