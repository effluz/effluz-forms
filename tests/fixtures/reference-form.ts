import {
  conditionalConsentItems,
  consentItems,
  consentTextVersion,
} from "@/shared/domain/form-model";

// Encodes specs/use-cases/reference-form-preemie-stories.md as a draft input object.
// Spanish single-language, like the original. All names and values are synthetic.

const es = (text: string) => ({ es: text });

const consentText = es(
  "Soy mayor de edad y tengo autoridad para compartir la información y las fotos o videos " +
    "de mi hijo o hija. Autorizo a Effluz a usar lo que envío en este formulario en sus " +
    "redes sociales, página web y campañas sobre bebés prematuros. Entiendo que Effluz guarda " +
    "mis respuestas y archivos en servidores en Estados Unidos y en su cuenta de Dropbox " +
    "durante 12 meses, que las personas del equipo de Effluz con acceso a esa cuenta pueden " +
    "verlos, que Effluz puede revisar la ortografía y gramática de mis textos con un servicio " +
    "automático de corrección (DeepL) conservando el original, y que puedo pedir que se " +
    "eliminen antes escribiendo a {privacy contact}.\n\n" +
    "Las fotos que nos envíes después para esta historia se guardan y usan de la misma forma.",
);

const required = { required: true } as const;

export const referenceFormDraft = {
  languages: "es",
  title: { es: "Historias" },
  pages: [
    {
      key: "page1",
      title: es("Historia de bebé prematuro"),
      description: es(
        "Gracias por querer compartir tu historia.\n\n" +
          "Síguenos en [Instagram](https://www.instagram.com/effluzpreemiesandtwins/) y " +
          "[Facebook](https://www.facebook.com/EffluzPreemiesAndTwins).",
      ),
      fields: [
        {
          key: "adult_name",
          type: "short_text",
          label: es("Nombre y apellido completo del adulto responsable"),
          ...required,
        },
        { key: "phone", type: "phone", label: es("Celular"), ...required },
        {
          key: "email",
          type: "email",
          label: es("E-mail"),
          ...required,
          settings: { isSubmitterAddress: true },
        },
        { key: "instagram", type: "short_text", label: es("Tu instagram"), ...required },
      ],
    },
    {
      key: "page2",
      title: es("Permisos"),
      fields: [
        {
          key: "photo_auth",
          type: "single_choice",
          label: es(
            "¿Autorizas a Effluz a usar las fotos y videos que envíes en sus campañas? " +
              "Las imágenes podrán publicarse en redes sociales y en la página web. " +
              "Puedes pedir que se retiren cuando quieras.",
          ),
          ...required,
          settings: {
            display: "radio",
            options: [
              { key: "yes_opt", label: es("Sí") },
              { key: "no_opt", label: es("No") },
            ],
          },
        },
        {
          key: "contact_auth",
          type: "single_choice",
          label: es("¿Autorizas que Effluz te contacte?"),
          ...required,
          settings: {
            display: "radio",
            options: [
              { key: "by_phone", label: es("Sí por celular") },
              { key: "by_email", label: es("Sí por email") },
              { key: "either", label: es("Sí por celular o email") },
              { key: "none", label: es("No") },
            ],
          },
        },
      ],
    },
    {
      key: "page3",
      title: es("Sobre el bebé"),
      fields: [
        {
          key: "pregnancy",
          type: "single_choice",
          label: es("Tu embarazo fue"),
          ...required,
          settings: {
            display: "radio",
            options: [
              { key: "single", label: es("Un solo bebé") },
              { key: "twins", label: es("Gemelar") },
              { key: "triplets", label: es("Trillizos") },
              { key: "more", label: es("Más de 3 bebés") },
            ],
          },
        },
        {
          key: "baby_name",
          type: "short_text",
          label: es("Nombre de la niña o niño"),
          ...required,
        },
        {
          key: "pediatrician",
          type: "short_text",
          label: es("¿Quién fue su pediatra?"),
          ...required,
        },
        { key: "hospital", type: "short_text", label: es("¿En qué hospital nació?"), ...required },
        {
          key: "weeks",
          type: "short_text",
          label: es("¿De cuántas semanas nació tu bebé?"),
          ...required,
        },
        {
          key: "weight",
          type: "short_text",
          label: es("¿Cuánto pesó tu bebé al nacer?"),
          ...required,
        },
        {
          key: "age_birthdate",
          type: "short_text",
          label: es("Edad y fecha de nacimiento de tu bebé"),
          ...required,
        },
      ],
    },
    {
      key: "page4",
      title: es("La historia"),
      fields: [
        {
          key: "helpers",
          type: "long_text",
          label: es("¿Quiénes te ayudaron durante el proceso?"),
          ...required,
        },
        {
          key: "story",
          type: "long_text",
          label: es("Escribe tu historia (lo más breve posible)"),
          help: es(
            "Incluye:\n" +
              "- Cuánto tiempo pasó en el hospital.\n" +
              "- Fue cesárea o parto natural.\n" +
              "- Qué fue lo que hizo que naciera antes de tiempo (si sabes la razón).\n" +
              "- Complicaciones que sufrió durante o después de su nacimiento.\n" +
              "- Edad actual y cómo se encuentra.\n\n" +
              "[VER PUBLICACIÓN](https://www.instagram.com/effluzpreemiesandtwins/)",
          ),
          ...required,
        },
        {
          key: "source",
          type: "single_choice",
          label: es("¿Cómo llegaste a este formulario?"),
          ...required,
          settings: {
            display: "radio",
            options: [
              { key: "instagram", label: es("Instagram") },
              { key: "facebook", label: es("Facebook") },
              { key: "friend", label: es("Por una amiga o amigo") },
              { key: "search", label: es("Google o similar") },
            ],
          },
        },
      ],
    },
    {
      key: "page5",
      title: es("Fotos y consentimiento"),
      fields: [
        {
          key: "photos",
          type: "file_upload",
          label: es("Sube hasta 10 fotos sin editar del bebé"),
          help: es(
            "Fotos del hospital y fotos actuales. Puedes agregar un video corto con un " +
              "mensaje para otras familias. No envíes imágenes de otras personas.",
          ),
          ...required,
          validation: [{ rule: "min_files", value: 1 }],
          settings: { kinds: ["image", "video"], maxFiles: 10, maxSizeMb: 10 },
        },
        {
          key: "info",
          type: "section",
          settings: {
            title: es("Información"),
            description: es(
              "Estamos preparando una campaña sobre bebés prematuros. Recibimos historias " +
                "hasta la fecha de cierre del formulario.",
            ),
          },
        },
        {
          key: "consent",
          type: "consent",
          label: es("Consentimiento"),
          ...required,
          settings: {
            text: consentText,
            coveredItems: [...consentItems, ...conditionalConsentItems],
          },
        },
      ],
    },
  ],
  confirmation: { screen: es("Gracias por la información. No necesitas confirmar nada más.") },
};

/** Synthetic answers: invented names, example.com address, placeholder media ids. */
export const referenceSubmission: Record<string, unknown> = {
  adult_name: "Lucía Prueba Ejemplo",
  phone: "+507 0000 0000",
  email: "familia@example.com",
  instagram: "@prueba_0000_effluz",
  photo_auth: "yes_opt",
  contact_auth: "either",
  pregnancy: "single",
  baby_name: "Mateo Prueba",
  pediatrician: "Dra. Ejemplo",
  hospital: "Hospital de Prueba",
  weeks: "30",
  weight: "1.4 kg",
  age_birthdate: "6 meses, 2026-04-10",
  helpers: "La familia y el equipo del hospital de prueba.",
  story: "Una historia inventada para pruebas automáticas.",
  source: "instagram",
  photos: ["media_aaaaaaaa", "media_bbbbbbbb"],
  consent: { accepted: true, textVersion: consentTextVersion(consentText) },
};
