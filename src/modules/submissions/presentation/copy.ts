import type { Locale } from "@/shared/domain/localized-text";
import { fill, type Text } from "@/shared/presentation/copy";

/**
 * Copy bindings for the public renderer. The text is owned by specs/ui-ux/renderer.md
 * ("Fixed chrome copy" and "Message catalog"); `copy.test.ts` keeps these objects equal to
 * those rows.
 */
export const chrome = {
  skip_link: { en: "Skip to form", es: "Ir al formulario" },
  language_switch_label: { en: "Language", es: "Idioma" },
  progress: { en: "Page {n} of {total}", es: "Página {n} de {total}" },
  required_legend: {
    en: "Fields marked with * are required",
    es: "Los campos marcados con * son obligatorios",
  },
  back: { en: "Back", es: "Atrás" },
  next: { en: "Next", es: "Siguiente" },
  submit: { en: "Submit", es: "Enviar" },
  submitting: { en: "Submitting…", es: "Enviando…" },
  choose_one: { en: "Choose one", es: "Elige una opción" },
  choose_files: { en: "Choose files", es: "Elegir archivos" },
  files_count: { en: "{count} of {max} files", es: "{count} de {max} archivos" },
  files_limits_images: { en: "Photos up to {size} each.", es: "Fotos de hasta {size} cada una." },
  files_limits_mixed: {
    en: "Photos and videos up to {size} each.",
    es: "Fotos y videos de hasta {size} cada uno.",
  },
  video_notice: {
    en: "Videos are stored exactly as sent. Unlike photos, we cannot remove hidden details such as location from them.",
    es: "Los videos se guardan tal como se envían. A diferencia de las fotos, no podemos quitarles datos ocultos como la ubicación.",
  },
  uploading: { en: "Uploading {percent}%", es: "Subiendo {percent}%" },
  uploaded: { en: "Uploaded", es: "Subido" },
  remove: { en: "Remove", es: "Quitar" },
  retry: { en: "Retry", es: "Reintentar" },
  uploads_pending: {
    en: "Wait for uploads to finish before continuing",
    es: "Espera a que terminen las subidas para continuar",
  },
  error_summary_heading: {
    en: "Please fix {count} problems before continuing",
    es: "Corrige {count} problemas para continuar",
  },
  consent_checkbox: { en: "I have read and agree", es: "He leído y acepto" },
  char_count: { en: "{n} of {max} characters", es: "{n} de {max} caracteres" },
  confirmation_reference: { en: "Your reference: {ref}", es: "Tu referencia: {ref}" },
  confirmation_close: { en: "You can close this page.", es: "Puedes cerrar esta página." },
  fill_another: { en: "Fill in another form", es: "Llenar otro formulario" },
  closed_title: { en: "This form is closed", es: "Este formulario está cerrado" },
  closed_body: {
    en: "It no longer accepts responses. Thank you for your interest.",
    es: "Ya no acepta respuestas. Gracias por tu interés.",
  },
  not_open_title: { en: "This form is not open yet", es: "Este formulario aún no está abierto" },
  not_open_body: { en: "It opens on {date}.", es: "Abre el {date}." },
  not_found_title: { en: "We could not find this form", es: "No encontramos este formulario" },
  not_found_body: {
    en: "Check the link, or ask the person who shared it with you.",
    es: "Revisa el enlace o pregunta a quien te lo compartió.",
  },
  expired_title: { en: "Your session expired", es: "Tu sesión expiró" },
  expired_body: {
    en: "For your privacy, unfinished answers are kept for 24 hours only. Please start again.",
    es: "Por tu privacidad, las respuestas sin terminar se guardan solo 24 horas. Por favor, empieza de nuevo.",
  },
  start_again: { en: "Start again", es: "Empezar de nuevo" },
  error_title: { en: "Something went wrong", es: "Algo salió mal" },
  error_body: {
    en: "Your answers on this page were not saved. Please try again.",
    es: "Las respuestas de esta página no se guardaron. Inténtalo de nuevo.",
  },
  try_again: { en: "Try again", es: "Intentar de nuevo" },
  submit_failed: {
    en: "Your answers were not sent. Check your connection and try again.",
    es: "Tus respuestas no se enviaron. Revisa tu conexión e inténtalo de nuevo.",
  },
  offline: {
    en: "You seem to be offline. We will continue when you reconnect.",
    es: "Parece que no tienes conexión. Continuaremos cuando vuelvas a conectarte.",
  },
  privacy_footer: {
    en: "This form is run by Effluz. Answers are stored in the United States and deleted after {retention} months. To request deletion, write to {contact}.",
    es: "Este formulario es de Effluz. Las respuestas se guardan en Estados Unidos y se eliminan después de {retention} meses. Para pedir que se eliminen, escribe a {contact}.",
  },
  switch_to_en: { en: "English", es: "English" },
  switch_to_es: { en: "Español", es: "Español" },
  wordmark: { en: "Effluz", es: "Effluz" },
  date_day: { en: "Day", es: "Día" },
  date_month: { en: "Month", es: "Mes" },
  date_year: { en: "Year", es: "Año" },
  files_limits_videos: { en: "Videos up to {size} each.", es: "Videos de hasta {size} cada uno." },
  kinds_images: { en: "JPEG, PNG, WebP or HEIC photos", es: "fotos JPEG, PNG, WebP o HEIC" },
  kinds_videos: { en: "MP4 or MOV videos", es: "videos MP4 o MOV" },
  kinds_mixed: {
    en: "JPEG, PNG, WebP or HEIC photos, or MP4 or MOV videos",
    es: "fotos JPEG, PNG, WebP o HEIC, o videos MP4 o MOV",
  },
  file_row: { en: "File {n}, {size}", es: "Archivo {n}, {size}" },
  removed: { en: "{file} removed", es: "Se quitó {file}" },
  honeypot_label: { en: "Leave this field empty", es: "Deja este campo vacío" },
  error_summary_heading_one: {
    en: "Please fix 1 problem before continuing",
    es: "Corrige 1 problema para continuar",
  },
  files_count_one: { en: "{count} of 1 file", es: "{count} de 1 archivo" },
  file_unnamed: { en: "File {n}", es: "Archivo {n}" },
  remove_failed: {
    en: "{file} was not removed. Check your connection and try again",
    es: "No se pudo quitar {file}. Revisa tu conexión e inténtalo de nuevo",
  },
  group_required: { en: "required", es: "obligatorio" },
} as const satisfies Record<string, Text>;

/** Keyed by the rule name with spaces, as the catalog table writes it. */
export const catalog = {
  required: { en: "{label} is required", es: "{label} es obligatorio" },
  "min length": {
    en: "{label} must have at least {n} characters",
    es: "{label} debe tener al menos {n} caracteres",
  },
  "max length": {
    en: "{label} must have no more than {n} characters",
    es: "{label} no debe tener más de {n} caracteres",
  },
  pattern: {
    en: "{label} is not in the expected format",
    es: "{label} no tiene el formato esperado",
  },
  "email syntax": {
    en: "Enter a valid email address, like name@example.com",
    es: "Escribe un correo válido, como nombre@ejemplo.com",
  },
  "number min": { en: "{label} must be at least {n}", es: "{label} debe ser al menos {n}" },
  "number max": { en: "{label} must be no more than {n}", es: "{label} no debe ser más de {n}" },
  integer: { en: "{label} must be a whole number", es: "{label} debe ser un número entero" },
  "not a number": { en: "{label} must be a number", es: "{label} debe ser un número" },
  "date invalid": {
    en: "Enter a real date for {label}",
    es: "Escribe una fecha real para {label}",
  },
  "date min": {
    en: "{label} must be on or after {date}",
    es: "{label} debe ser el {date} o después",
  },
  "date max": {
    en: "{label} must be on or before {date}",
    es: "{label} debe ser el {date} o antes",
  },
  "date not future": {
    en: "{label} cannot be in the future",
    es: "{label} no puede ser una fecha futura",
  },
  "choice min": {
    en: "Select at least {n} options for {label}",
    es: "Selecciona al menos {n} opciones en {label}",
  },
  "choice max": {
    en: "Select no more than {n} options for {label}",
    es: "Selecciona como máximo {n} opciones en {label}",
  },
  "must be true": {
    en: "You must check {label} to continue",
    es: "Debes marcar {label} para continuar",
  },
  consent: { en: "You must agree to continue", es: "Debes aceptar para continuar" },
  "files min": {
    en: "Upload at least {n} files for {label}",
    es: "Sube al menos {n} archivos en {label}",
  },
  "files max": {
    en: "You can upload up to {n} files for {label}",
    es: "Puedes subir hasta {n} archivos en {label}",
  },
  "invalid shape": {
    en: "{label} has an unexpected value. Please try again",
    es: "{label} tiene un valor inesperado. Inténtalo de nuevo",
  },
  "unknown option": {
    en: "Choose one of the listed options for {label}",
    es: "Elige una de las opciones de {label}",
  },
  "file too large": { en: "{file} is larger than {size}", es: "{file} pesa más de {size}" },
  "file wrong type": {
    en: "{file} is not a supported type. Use {kinds}",
    es: "{file} no es un tipo permitido. Usa {kinds}",
  },
  "file unreadable": {
    en: "{file} could not be read. Try another file",
    es: "No se pudo leer {file}. Prueba con otro archivo",
  },
  "upload failed": {
    en: "{file} did not upload. Check your connection and retry",
    es: "{file} no se subió. Revisa tu conexión y reintenta",
  },
  "min length one": {
    en: "{label} must have at least {n} character",
    es: "{label} debe tener al menos {n} carácter",
  },
  "max length one": {
    en: "{label} must have no more than {n} character",
    es: "{label} no debe tener más de {n} carácter",
  },
  "choice min one": {
    en: "Select at least {n} option for {label}",
    es: "Selecciona al menos {n} opción en {label}",
  },
  "choice max one": {
    en: "Select no more than {n} option for {label}",
    es: "Selecciona como máximo {n} opción en {label}",
  },
  "files min one": {
    en: "Upload at least {n} file for {label}",
    es: "Sube al menos {n} archivo en {label}",
  },
  "files max one": {
    en: "You can upload up to {n} file for {label}",
    es: "Puedes subir hasta {n} archivo en {label}",
  },
  "submission too large": {
    en: "{file} would take this form's files past {size} in total",
    es: "{file} haría que los archivos de este formulario pasen de {size} en total",
  },
} as const satisfies Record<string, Text>;

export type ChromeKey = keyof typeof chrome;
export type CatalogKey = keyof typeof catalog;

/** One fixed-chrome string in the locale, placeholders filled. */
export function t(
  locale: Locale,
  key: ChromeKey,
  vars: Readonly<Record<string, string>> = {},
): string {
  return fill(chrome[key][locale], vars);
}

/** Whether the language's plural rules call this count "one" (renderer.md, Message catalog). */
export function isOne(locale: Locale, n: number): boolean {
  return new Intl.PluralRules(locale).select(n) === "one";
}
