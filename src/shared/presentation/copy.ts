/**
 * Copy bindings for the manager chrome: shell, home, form overview, lifecycle,
 * settings, share, audit, the New form dialog and the builder placeholder. The text
 * is owned by specs/ui-ux/manager.md and specs/ui-ux/builder.md ("Fixed chrome
 * copy"); `copy.test.ts` keeps this object equal to those rows.
 */
export const copy = {
  "nav.forms": { en: "Forms", es: "Formularios" },
  "nav.operations": { en: "Operations", es: "Operaciones" },
  "nav.audit": { en: "Audit", es: "Auditoría" },
  "nav.language": { en: "Language", es: "Idioma" },
  "nav.shortcuts": { en: "Keyboard shortcuts", es: "Atajos de teclado" },
  "nav.sign_out": { en: "Sign out", es: "Cerrar sesión" },
  "home.active": { en: "Active", es: "Activos" },
  "home.closed": { en: "Closed", es: "Cerrados" },
  "home.archived": { en: "Archived", es: "Archivados" },
  "home.new_form": { en: "New form", es: "Nuevo formulario" },
  "home.search": { en: "Search forms", es: "Buscar formularios" },
  "home.col_title": { en: "Title", es: "Título" },
  "home.col_status": { en: "Status", es: "Estado" },
  "home.col_new": { en: "New", es: "Nuevos" },
  "home.col_total": { en: "Total", es: "Total" },
  "home.col_last": { en: "Last submission", es: "Última respuesta" },
  "home.col_closes": { en: "Closes", es: "Cierra" },
  "home.empty": {
    en: "No forms yet. Create the first one.",
    es: "Aún no hay formularios. Crea el primero.",
  },
  "home.banner_worker": {
    en: "Background jobs are not running.",
    es: "Los trabajos en segundo plano no se están ejecutando.",
  },
  "home.banner_dead": {
    en: "{count} jobs need attention.",
    es: "{count} trabajos necesitan atención.",
  },
  "home.banner_backup": {
    en: "The last backup is older than two days.",
    es: "La última copia de seguridad tiene más de dos días.",
  },
  "home.see_operations": { en: "See Operations", es: "Ver Operaciones" },
  "shell.wordmark": { en: "Effluz", es: "Effluz" },
  "shell.signed_in_as": { en: "Signed in as {name}", es: "Sesión iniciada como {name}" },
  "shell.skip_to_main": { en: "Skip to main content", es: "Saltar al contenido principal" },
  "shell.main_nav": { en: "Main navigation", es: "Navegación principal" },
  "shell.breadcrumb": { en: "Breadcrumb", es: "Ruta de navegación" },
  "shell.cancel": { en: "Cancel", es: "Cancelar" },
  "form.edit": { en: "Edit in builder", es: "Editar en el constructor" },
  "form.share": { en: "Share", es: "Compartir" },
  "form.closing_in": { en: "Closing in {n} days", es: "Cierra en {n} días" },
  "form.tab_submissions": { en: "Submissions", es: "Respuestas" },
  "form.tab_settings": { en: "Settings", es: "Configuración" },
  "form.tab_share": { en: "Share", es: "Compartir" },
  "form.tab_activity": { en: "Activity", es: "Actividad" },
  "life.close": { en: "Close form", es: "Cerrar formulario" },
  "life.close_body": {
    en: "People with the link will see that the form is closed. Submissions already received are kept.",
    es: "Quienes tengan el enlace verán que el formulario está cerrado. Las respuestas recibidas se conservan.",
  },
  "life.reopen": { en: "Reopen form", es: "Reabrir formulario" },
  "life.reopen_body": {
    en: "The form will accept submissions again at the same link.",
    es: "El formulario volverá a aceptar respuestas en el mismo enlace.",
  },
  "life.archive": { en: "Archive form", es: "Archivar formulario" },
  "life.archive_body": {
    en: "The form closes and moves to Archived. Nothing is deleted.",
    es: "El formulario se cierra y pasa a Archivados. No se elimina nada.",
  },
  "life.unarchive": { en: "Unarchive", es: "Desarchivar" },
  "life.delete": { en: "Delete form", es: "Eliminar formulario" },
  "life.delete_body": {
    en: "This form has never been published and has no submissions. Deleting it cannot be undone. Type the link name to confirm.",
    es: "Este formulario nunca se publicó y no tiene respuestas. Eliminarlo no se puede deshacer. Escribe el nombre del enlace para confirmar.",
  },
  "life.banner_closed": {
    en: "This form is closed. People with the link see a closed message.",
    es: "Este formulario está cerrado. Quienes tengan el enlace ven un mensaje de cierre.",
  },
  "life.banner_archived": { en: "This form is archived.", es: "Este formulario está archivado." },
  "form.error_transition": {
    en: "That action is no longer available for this form. Reload to see its current status.",
    es: "Esa acción ya no está disponible para este formulario. Recarga para ver su estado actual.",
  },
  "builder.placeholder": {
    en: "The builder is coming soon. Settings and sharing already work.",
    es: "El constructor llegará pronto. La configuración y el enlace ya funcionan.",
  },
  "set.notifications": { en: "Notifications", es: "Notificaciones" },
  "set.recipients": { en: "Recipients", es: "Destinatarios" },
  "set.recipients_hint": { en: "Only Effluz addresses", es: "Solo correos de Effluz" },
  "set.cadence": { en: "Send", es: "Enviar" },
  "set.cadence_each": { en: "One email per submission", es: "Un correo por respuesta" },
  "set.cadence_daily": { en: "A daily summary at", es: "Un resumen diario a las" },
  "set.data": { en: "Data", es: "Datos" },
  "set.retention": { en: "Keep submissions for", es: "Conservar respuestas durante" },
  "set.months": { en: "months", es: "meses" },
  "set.retention_hint": {
    en: "Counted from each submission. Deletion is permanent.",
    es: "Se cuenta desde cada respuesta. La eliminación es permanente.",
  },
  "set.retention_warn": {
    en: "Shortening to {n} months will delete {count} submissions on the next run.",
    es: "Reducir a {n} meses eliminará {count} respuestas en la próxima ejecución.",
  },
  "set.prefix": { en: "Reference prefix", es: "Prefijo de referencia" },
  "set.prefix_hint": {
    en: "Used in reference numbers and folder names. Fixed after the first submission.",
    es: "Se usa en los números de referencia y nombres de carpeta. Fijo después de la primera respuesta.",
  },
  "set.availability": { en: "Availability", es: "Disponibilidad" },
  "set.opens": { en: "Opens", es: "Abre" },
  "set.closes": { en: "Closes", es: "Cierra" },
  "set.timezone": { en: "Time zone", es: "Zona horaria" },
  "set.protection": { en: "Protection", es: "Protección" },
  "set.challenge": {
    en: "Ask people to complete a bot check before submitting",
    es: "Pedir una verificación anti-bots antes de enviar",
  },
  "set.challenge_hint": {
    en: "Harder for some people with disabilities. Turn on only if spam appears.",
    es: "Más difícil para algunas personas con discapacidad. Actívalo solo si aparece spam.",
  },
  "set.responses": { en: "Responses", es: "Respuestas" },
  "set.allow_another": {
    en: 'Offer "Fill in another form" after submitting',
    es: 'Ofrecer "Llenar otro formulario" al terminar',
  },
  "set.link": { en: "Link", es: "Enlace" },
  "set.save": { en: "Save settings", es: "Guardar configuración" },
  "set.saved": { en: "Settings saved", es: "Configuración guardada" },
  "set.discard_warn": { en: "You have unsaved changes.", es: "Tienes cambios sin guardar." },
  "sh.url": { en: "Public link", es: "Enlace público" },
  "sh.copy": { en: "Copy", es: "Copiar" },
  "sh.copied": { en: "Copied", es: "Copiado" },
  "sh.qr": { en: "QR code", es: "Código QR" },
  "sh.png_small": { en: "PNG 1024 px", es: "PNG 1024 px" },
  "sh.png_large": { en: "PNG 2048 px", es: "PNG 2048 px" },
  "sh.svg": { en: "SVG", es: "SVG" },
  "sh.pdf": { en: "Print sheet (PDF)", es: "Hoja para imprimir (PDF)" },
  "sh.unreachable": {
    en: "The form is not reachable right now: {reason}. The link and QR will work once it is.",
    es: "El formulario no está disponible ahora: {reason}. El enlace y el QR funcionarán cuando lo esté.",
  },
  "sh.stable": {
    en: "The QR code and link stay the same when you publish changes.",
    es: "El código QR y el enlace no cambian cuando publicas cambios.",
  },
  "au.title": { en: "Audit log", es: "Registro de auditoría" },
  "au.actor": { en: "Who", es: "Quién" },
  "au.action": { en: "Action", es: "Acción" },
  "au.target": { en: "What", es: "Qué" },
  "au.when": { en: "When", es: "Cuándo" },
  "au.export": { en: "Export CSV", es: "Exportar CSV" },
  "au.retention": { en: "Entries are kept for one year.", es: "Las entradas se conservan un año." },
  "new.title": { en: "New form", es: "Nuevo formulario" },
  "new.blank": { en: "Blank", es: "En blanco" },
  "new.duplicate": { en: "Duplicate an existing form", es: "Duplicar un formulario existente" },
  "new.form_title": { en: "Title", es: "Título" },
  "new.languages": { en: "Languages", es: "Idiomas" },
  "new.bilingual": { en: "English and Spanish", es: "Inglés y español" },
  "new.only_en": { en: "English only", es: "Solo inglés" },
  "new.only_es": { en: "Spanish only", es: "Solo español" },
  "new.slug": { en: "Link name", es: "Nombre del enlace" },
  "new.slug_hint": {
    en: "Letters, numbers and hyphens. Cannot change after publishing.",
    es: "Letras, números y guiones. No se puede cambiar después de publicar.",
  },
  "new.slug_taken": { en: "That link name is taken", es: "Ese nombre de enlace ya existe" },
  "new.copy_of": { en: "Copy of {title}", es: "Copia de {title}" },
  "new.create": { en: "Create", es: "Crear" },
} as const satisfies Record<string, Text>;

/** One staff-facing text in both languages. */
export type Text = { readonly en: string; readonly es: string };

export type CopyKey = keyof typeof copy;

/** Replaces `{name}` placeholders. The result is rendered as text, never as markup. */
export function fill(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

/**
 * Both languages as one plain string, for places that take a single string such as
 * `aria-label` and `<title>`. Identical text is given once.
 */
export function bothLanguages(text: Text, vars: Readonly<Record<string, string>> = {}): string {
  const en = fill(text.en, vars);
  const es = fill(text.es, vars);
  return en === es ? en : `${en} / ${es}`;
}
