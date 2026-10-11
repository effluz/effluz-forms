import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { seedPublished } from "@/modules/definitions/application/testing/fakes";
import { buildDefaultRegistry, parseDraft } from "@/shared/domain/form-model";
import { referenceFormDraft } from "../../../../tests/fixtures/reference-form";
import { makeSubmissionsDeps } from "../application/testing/fakes";
import { viewForm } from "../application/view-form";
import { newInProgress } from "../domain/in-progress";
import { RendererScreen } from "./Screens";

const registry = buildDefaultRegistry();
const BUDGET_BYTES = 15 * 1024;

describe("page weight", () => {
  it("keeps every page of the reference form well under 30 KB compressed", async () => {
    const parsed = parseDraft(referenceFormDraft, registry);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await seedPublished(deps.definitions, {
      slug: "historia-prematuro-2026",
      document: parsed.version,
    });
    const now = deps.clock.now();
    for (const [index, page] of parsed.version.pages.entries()) {
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      await deps.inProgress.insert(
        await deps.uow.begin(),
        newInProgress({
          id,
          formId,
          versionId,
          locale: "es",
          pageKey: page.key,
          submitToken: `00000000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`,
          startedAt: now,
          now,
        }),
      );
      const view = await viewForm(deps, {
        slug: "historia-prematuro-2026",
        state: { kind: "record", id },
        acceptLanguage: null,
        expired: false,
      });
      if (view.screen !== "page") throw new Error(`page ${page.key}: ${view.screen}`);
      const html = renderToStaticMarkup(
        createElement(RendererScreen, {
          view,
          slug: "historia-prematuro-2026",
          contact: "privacy@example.com",
          registry,
          formAction: () => Promise.resolve(),
          refusedFiles: [],
        }),
      );
      expect(gzipSync(html).length, `page ${page.key}`).toBeLessThan(BUDGET_BYTES);
    }
  });
});
