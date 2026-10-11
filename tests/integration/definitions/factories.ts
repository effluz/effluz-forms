import { randomUUID } from "node:crypto";
import type { FormVersion } from "@/modules/definitions/application/ports/version-repository";
import { emptyDocument, type Draft } from "@/modules/definitions/domain/draft";
import type { Form } from "@/modules/definitions/domain/form";
import { defaultSettings } from "@/modules/definitions/domain/settings";
import type { LocalizedText } from "@/shared/domain/localized-text";

const ids = { newId: () => randomUUID() };

export function sampleForm(overrides: Partial<Form> = {}): Form {
  const slug = overrides.slug ?? `sample-${randomUUID().slice(0, 8)}`;
  return {
    id: randomUUID(),
    slug,
    title: { en: "Sample form", es: "Formulario de ejemplo" },
    languages: "bilingual",
    status: "draft",
    settings: defaultSettings(slug),
    currentVersionId: null,
    currentVersionNumber: null,
    archivedAt: null,
    createdAt: new Date("2026-10-10T12:00:00.000Z"),
    updatedAt: new Date("2026-10-10T12:00:00.000Z"),
    ...overrides,
  };
}

export function sampleDraft(formId: string, title: LocalizedText = {}): Draft {
  return {
    formId,
    revision: 1,
    document: emptyDocument(title, "bilingual", ids),
    updatedBy: "staff@example.com",
    updatedAt: new Date("2026-10-10T12:00:00.000Z"),
    auditedBy: "staff@example.com",
    auditedAt: new Date("2026-10-10T12:00:00.000Z"),
  };
}

export function sampleVersion(formId: string, number: number): FormVersion {
  return {
    id: randomUUID(),
    formId,
    number,
    document: emptyDocument({ en: "Sample", es: "Ejemplo" }, "bilingual", ids),
    publishedAt: new Date("2026-10-11T08:00:00.000Z"),
    publishedBy: "staff@example.com",
  };
}
