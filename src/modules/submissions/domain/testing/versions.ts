// Synthetic form versions shared by the submissions module's tests.
import {
  buildDefaultRegistry,
  consentItems,
  parseDraft,
  type FieldTypeRegistry,
  type Version,
} from "@/shared/domain/form-model";
import type { LocalizedText } from "@/shared/domain/localized-text";

export const registry: FieldTypeRegistry = buildDefaultRegistry();

export const CONSENT_TEXT: LocalizedText = {
  en: "I am an adult and agree that Effluz keeps these synthetic answers for 12 months.",
  es: "Soy mayor de edad y acepto que Effluz guarde estas respuestas sintéticas durante 12 meses.",
};

const text = (en: string, es: string): LocalizedText => ({ en, es });

/** Three pages: contact (name, submitter email, has_baby), baby (photos, shown when has_baby = yes_opt), consent. */
export function storyVersion(): Version {
  const parsed = parseDraft(
    {
      languages: "bilingual",
      title: text("Stories", "Historias"),
      confirmation: {
        screen: text("Thank you.", "Gracias."),
        email: { subject: text("Thanks", "Gracias"), body: text("We got it.", "Lo recibimos.") },
      },
      pages: [
        {
          key: "page_contact",
          title: text("Contact", "Contacto"),
          fields: [
            { key: "f_name", type: "short_text", label: text("Name", "Nombre"), required: true },
            {
              key: "f_email",
              type: "email",
              label: text("Email", "Correo"),
              settings: { isSubmitterAddress: true },
            },
            {
              key: "f_baby",
              type: "single_choice",
              label: text("Baby?", "¿Bebé?"),
              required: true,
              settings: {
                options: [
                  { key: "yes_opt", label: text("Yes", "Sí") },
                  { key: "no_opt", label: text("No", "No") },
                ],
              },
            },
          ],
        },
        {
          key: "page_baby",
          title: text("Photos", "Fotos"),
          visibility: { field: "f_baby", op: "equals", value: "yes_opt" },
          fields: [
            {
              key: "f_photos",
              type: "file_upload",
              label: text("Photos", "Fotos"),
              required: true,
              validation: [{ rule: "min_files", value: 1 }],
              settings: { kinds: ["image", "video"], maxFiles: 3, maxSizeMb: 10 },
            },
          ],
        },
        {
          key: "page_consent",
          title: text("Consent", "Consentimiento"),
          fields: [
            {
              key: "f_consent",
              type: "consent",
              label: text("Consent", "Consentimiento"),
              required: true,
              settings: { text: CONSENT_TEXT, coveredItems: [...consentItems] },
            },
          ],
        },
      ],
    },
    registry,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.version;
}

/** Two pages: when (a date of birth and an email), then a note. */
export function datedVersion(): Version {
  const parsed = parseDraft(
    {
      languages: "bilingual",
      title: text("Dates", "Fechas"),
      confirmation: { screen: text("Thank you.", "Gracias.") },
      pages: [
        {
          key: "page_when",
          title: text("When", "Cuándo"),
          fields: [
            { key: "f_born", type: "date", label: text("Born", "Nacimiento") },
            { key: "f_email", type: "email", label: text("Email", "Correo") },
          ],
        },
        {
          key: "page_note",
          title: text("Note", "Nota"),
          fields: [{ key: "f_note", type: "short_text", label: text("Note", "Nota") }],
        },
      ],
    },
    registry,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.version;
}

/** Two pages: media (photos, shown when f_kind = photos_opt, and documents, always shown), then a note. */
export function twoUploadsVersion(): Version {
  const upload = (key: string, label: LocalizedText, extra: object = {}) => ({
    key,
    type: "file_upload",
    label,
    settings: { kinds: ["image"], maxFiles: 3, maxSizeMb: 10 },
    ...extra,
  });
  const parsed = parseDraft(
    {
      languages: "bilingual",
      title: text("Media", "Medios"),
      confirmation: { screen: text("Thank you.", "Gracias.") },
      pages: [
        {
          key: "page_media",
          title: text("Media", "Medios"),
          fields: [
            {
              key: "f_kind",
              type: "single_choice",
              label: text("Photos?", "¿Fotos?"),
              settings: {
                options: [
                  { key: "photos_opt", label: text("Yes", "Sí") },
                  { key: "none_opt", label: text("No", "No") },
                ],
              },
            },
            upload("f_photos", text("Photos", "Fotos"), {
              visibility: { field: "f_kind", op: "equals", value: "photos_opt" },
            }),
            upload("f_docs", text("Documents", "Documentos")),
          ],
        },
        {
          key: "page_note",
          title: text("Note", "Nota"),
          fields: [{ key: "f_note", type: "short_text", label: text("Note", "Nota") }],
        },
      ],
    },
    registry,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.version;
}
