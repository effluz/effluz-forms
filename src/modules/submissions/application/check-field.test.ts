import { describe, expect, it } from "vitest";
import { asKey } from "@/shared/domain/form-model";
import { newInProgress } from "../domain/in-progress";
import { checkField } from "./check-field";
import { postContext, type OpenContext } from "./post-context";
import { makeSubmissionsDeps, publishStory } from "./testing/fakes";

async function openContext(): Promise<{
  deps: ReturnType<typeof makeSubmissionsDeps>;
  ctx: OpenContext;
}> {
  const deps = makeSubmissionsDeps();
  await publishStory(deps);
  const ctx = await postContext(deps, {
    slug: "story-form",
    state: { kind: "none" },
    submitToken: null,
  });
  if (!ctx.ok) throw new Error("closed");
  return { deps, ctx };
}

describe("checkField", () => {
  it("runs the server's rules for one field, and passes decode issues through", async () => {
    const { deps, ctx } = await openContext();
    expect(
      checkField(deps, ctx, { fieldKey: "f_email", answer: "nope", decodeIssue: null })?.issue,
    ).toEqual({ code: "email_syntax", field: "f_email" });
    expect(
      checkField(deps, ctx, { fieldKey: "f_email", answer: "a@example.com", decodeIssue: null })
        ?.issue,
    ).toBeNull();
    expect(
      checkField(deps, ctx, { fieldKey: "f_name", answer: "", decodeIssue: null })?.issue?.code,
    ).toBe("required");
    expect(
      checkField(deps, ctx, { fieldKey: "f_baby", answer: undefined, decodeIssue: "invalid_shape" })
        ?.issue,
    ).toEqual({ code: "invalid_shape", field: "f_baby" });
    expect(
      checkField(deps, ctx, { fieldKey: "f_nope", answer: "x", decodeIssue: null }),
    ).toBeNull();
  });

  it("answers null for a key that is not an input field", async () => {
    const { deps, ctx } = await openContext();
    expect(
      checkField(deps, ctx, { fieldKey: "page_contact", answer: "x", decodeIssue: null }),
    ).toBeNull();
  });

  it("judges a field's condition by the stored answers of its same-page siblings", async () => {
    const { deps, ctx } = await openContext();
    // f_email becomes required and visible only when the earlier f_name is "Ana Prueba".
    const document = {
      ...ctx.version.document,
      pages: ctx.version.document.pages.map((page) => ({
        ...page,
        fields: page.fields.map((f) =>
          f.key === "f_email"
            ? {
                ...f,
                required: true,
                visibility: { field: asKey("f_name"), op: "equals" as const, value: "Ana Prueba" },
              }
            : f,
        ),
      })),
    };
    const now = deps.clock.now();
    const record = newInProgress({
      id: "00000000-0000-4000-8000-0000000000aa",
      formId: ctx.form.id,
      versionId: ctx.version.id,
      locale: "es",
      pageKey: "page_contact",
      submitToken: "00000000-0000-4000-8000-0000000000bb",
      startedAt: now,
      now,
    });
    const open = (name: string): OpenContext => ({
      ...ctx,
      version: { ...ctx.version, document },
      record: { ...record, answers: { f_name: name } },
    });
    const blank = { fieldKey: "f_email", answer: "", decodeIssue: null } as const;
    expect(checkField(deps, open("Ana Prueba"), blank)?.issue?.code).toBe("required");
    expect(checkField(deps, open("Other"), blank)?.issue).toBeNull();
  });

  it("skips a field its condition hides, judged by the record's stored answers", async () => {
    const { deps, ctx } = await openContext();
    // The photos page shows only when f_baby = yes_opt; nothing is stored yet, so it is hidden.
    expect(
      checkField(deps, ctx, { fieldKey: "f_photos", answer: undefined, decodeIssue: null })?.issue,
    ).toBeNull();

    const now = deps.clock.now();
    const record = newInProgress({
      id: "00000000-0000-4000-8000-0000000000aa",
      formId: ctx.form.id,
      versionId: ctx.version.id,
      locale: "es",
      pageKey: "page_baby",
      submitToken: "00000000-0000-4000-8000-0000000000bb",
      startedAt: now,
      now,
    });
    const withBaby: OpenContext = { ...ctx, record: { ...record, answers: { f_baby: "yes_opt" } } };
    expect(
      checkField(deps, withBaby, { fieldKey: "f_photos", answer: undefined, decodeIssue: null })
        ?.issue?.field,
    ).toBe("f_photos");
  });
});
