/**
 * Copy bindings for the manager chrome: shell, home, form overview, lifecycle,
 * settings, share, audit, the status names and New form dialog shared with the
 * builder, and the builder placeholder. The text
 * is owned by specs/ui-ux/manager.md and specs/ui-ux/builder.md ("Fixed chrome
 * copy"); `copy.test.ts` keeps this object equal to those rows.
 */
export const copy = {
  "nav.forms": { en: "Forms", es: "Formularios" },
  "nav.plan": { en: "Post plan", es: "Plan de publicaciones" },
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
  "home.search_submit": { en: "Search", es: "Buscar" },
  "home.none_here": {
    en: "No forms to show here.",
    es: "No hay formularios para mostrar aquí.",
  },
  "home.version": { en: "v{n}", es: "v{n}" },
  "home.actions": { en: "Actions", es: "Acciones" },
  "home.open": { en: "Open", es: "Abrir" },
  "home.none": { en: "None", es: "Ninguna" },
  "status.draft": { en: "Draft", es: "Borrador" },
  "status.published": { en: "Published v{n}", es: "Publicado v{n}" },
  "status.closed": { en: "Closed", es: "Cerrado" },
  "status.archived": { en: "Archived", es: "Archivado" },
  "shell.wordmark": { en: "Effluz", es: "Effluz" },
  "shell.signed_in_as": { en: "Signed in as {name}", es: "Sesión iniciada como {name}" },
  "shell.skip_to_main": { en: "Skip to main content", es: "Saltar al contenido principal" },
  "shell.main_nav": { en: "Main navigation", es: "Navegación principal" },
  "shell.breadcrumb": { en: "Breadcrumb", es: "Ruta de navegación" },
  "shell.cancel": { en: "Cancel", es: "Cancelar" },
  "shell.not_found_title": { en: "Form not found", es: "Formulario no encontrado" },
  "shell.not_found_body": {
    en: "It may have been deleted, or the link is out of date. The forms list shows what exists today.",
    es: "Puede haber sido eliminado o el enlace está desactualizado. La lista de formularios muestra lo que existe hoy.",
  },
  "shell.not_found_back": { en: "Back to forms", es: "Volver a los formularios" },
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
  "life.unarchive_body": {
    en: "The form moves back to Closed, or to Draft if it was never published.",
    es: "El formulario vuelve a Cerrado, o a Borrador si nunca se publicó.",
  },
  "form.url_hint": { en: "Select the link and copy it.", es: "Selecciona el enlace y cópialo." },
  "form.error_slug_mismatch": {
    en: "The link name did not match. Nothing was deleted.",
    es: "El nombre del enlace no coincide. No se eliminó nada.",
  },
  "form.error_not_allowed": {
    en: "This form can no longer be deleted because it was published or has submissions. Archive it instead.",
    es: "Este formulario ya no se puede eliminar porque se publicó o tiene respuestas. Archívalo en su lugar.",
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
  "set.retention_confirm": { en: "Delete them and save", es: "Eliminarlas y guardar" },
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
  "set.challenge_unavailable": {
    en: "Not available yet: forms show no bot check even when this is on.",
    es: "Aún no está disponible: los formularios no muestran la verificación aunque esté activada.",
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
  "set.recipients_lines": { en: "One address per line.", es: "Una dirección por línea." },
  "set.no_recipients": {
    en: "No one will get an email about new submissions. They still appear here.",
    es: "Nadie recibirá un correo sobre las nuevas respuestas. Seguirán apareciendo aquí.",
  },
  "set.timezone_hint": {
    en: "Used for the open and close times and the daily summary.",
    es: "Se usa para las horas de apertura y cierre y para el resumen diario.",
  },
  "set.err_recipient_domain": {
    en: "{address} is not on an allowed domain.",
    es: "{address} no es de un dominio permitido.",
  },
  "set.err_recipient_syntax": {
    en: "{address} is not an email address.",
    es: "{address} no es una dirección de correo.",
  },
  "set.err_too_many_recipients": {
    en: "Enter at most {max} addresses.",
    es: "Escribe como máximo {max} direcciones.",
  },
  "set.err_prefix_format": {
    en: "Use 2 to 6 capital letters or digits.",
    es: "Usa de 2 a 6 letras mayúsculas o dígitos.",
  },
  "set.err_retention_range": {
    en: "Enter a whole number from {min} to {max}.",
    es: "Escribe un número entero de {min} a {max}.",
  },
  "set.err_date_order": {
    en: "The close time must be after the open time.",
    es: "La hora de cierre debe ser posterior a la de apertura.",
  },
  "set.err_timezone_unknown": {
    en: "Choose a time zone from the list.",
    es: "Elige una zona horaria de la lista.",
  },
  "set.err_hour_range": { en: "Choose an hour from the list.", es: "Elige una hora de la lista." },
  "set.err_malformed": {
    en: "This value could not be read. Check it and save again.",
    es: "No se pudo leer este valor. Revísalo y vuelve a guardar.",
  },
  "set.err_slug_locked": {
    en: "The link name cannot change after publishing.",
    es: "El nombre del enlace no se puede cambiar después de publicar.",
  },
  "set.err_prefix_locked": {
    en: "The prefix cannot change after the first submission.",
    es: "El prefijo no se puede cambiar después de la primera respuesta.",
  },
  "set.err_slug_taken": { en: "That link name is taken.", es: "Ese nombre de enlace ya existe." },
  "set.err_slug_format": {
    en: "Use 3 to 64 lowercase letters, numbers and hyphens.",
    es: "Usa de 3 a 64 minúsculas, números y guiones.",
  },
  "set.err_slug_reserved": {
    en: "That link name is reserved. Choose another.",
    es: "Ese nombre de enlace está reservado. Elige otro.",
  },
  "set.err_stale": {
    en: "This page was out of date, so nothing was saved. Reload it and try again.",
    es: "Esta página estaba desactualizada, así que no se guardó nada. Recárgala e inténtalo otra vez.",
  },
  "set.post_plan_section": { en: "Post plan", es: "Plan de publicaciones" },
  "set.post_plan": {
    en: "Use submissions in the post plan",
    es: "Usar las respuestas en el plan de publicaciones",
  },
  "set.post_plan_hint": {
    en: "Adds photo choice, readiness checks and a planned date to each submission, and shows them on the Post plan page.",
    es: "Agrega elección de fotos, verificaciones y una fecha planificada a cada respuesta, y las muestra en la página Plan de publicaciones.",
  },
  "set.post_plan_notice": {
    en: "Adding photos to a story stays off until you publish a version whose consent text covers photos sent later.",
    es: "Agregar fotos a una historia sigue desactivado hasta que publiques una versión cuyo texto de consentimiento cubra las fotos enviadas después.",
  },
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
  "sh.reason_draft": { en: "it has not been published", es: "todavía no se ha publicado" },
  "sh.reason_closed": { en: "it is closed", es: "está cerrado" },
  "sh.reason_archived": { en: "it is archived", es: "está archivado" },
  "sh.reason_not_open": { en: "it is not open yet", es: "todavía no abre" },
  "sh.reason_past_close": {
    en: "its close date has passed",
    es: "su fecha de cierre ya pasó",
  },
  "au.title": { en: "Audit log", es: "Registro de auditoría" },
  "au.actor": { en: "Who", es: "Quién" },
  "au.action": { en: "Action", es: "Acción" },
  "au.target": { en: "What", es: "Qué" },
  "au.when": { en: "When", es: "Cuándo" },
  "au.export": { en: "Export CSV", es: "Exportar CSV" },
  "au.retention": { en: "Entries are kept for one year.", es: "Las entradas se conservan un año." },
  "au.any_actor": { en: "Everyone", es: "Todas las personas" },
  "au.any_action": { en: "All actions", es: "Todas las acciones" },
  "au.apply": { en: "Filter", es: "Filtrar" },
  "au.empty": { en: "No activity matches.", es: "Ninguna actividad coincide." },
  "au.system": { en: "System", es: "Sistema" },
  "au.target_form": { en: "This form", es: "Este formulario" },
  "au.older": { en: "Older entries", es: "Entradas anteriores" },
  "au.action_form_created": { en: "Form created", es: "Formulario creado" },
  "au.action_draft_saved": { en: "Draft saved", es: "Borrador guardado" },
  "au.action_draft_language_mode_changed": { en: "Languages changed", es: "Idiomas cambiados" },
  "au.action_form_published": { en: "Form published", es: "Formulario publicado" },
  "au.action_form_closed": { en: "Form closed", es: "Formulario cerrado" },
  "au.action_form_reopened": { en: "Form reopened", es: "Formulario reabierto" },
  "au.action_form_archived": { en: "Form archived", es: "Formulario archivado" },
  "au.action_form_unarchived": {
    en: "Form restored from archive",
    es: "Formulario restaurado del archivo",
  },
  "au.action_form_deleted": { en: "Form deleted", es: "Formulario eliminado" },
  "au.action_form_settings_changed": { en: "Settings changed", es: "Configuración cambiada" },
  "au.action_retention_shortened": { en: "Retention shortened", es: "Retención acortada" },
  "au.action_submissions_listed": { en: "Submissions listed", es: "Respuestas listadas" },
  "au.action_submission_viewed": { en: "Submission opened", es: "Respuesta abierta" },
  "au.action_photo_viewed": { en: "Photo viewed", es: "Foto vista" },
  "au.action_media_downloaded": { en: "Files downloaded", es: "Archivos descargados" },
  "au.action_submissions_exported": { en: "Submissions exported", es: "Respuestas exportadas" },
  "au.action_submission_deleted": { en: "Submission deleted", es: "Respuesta eliminada" },
  "au.action_submission_edited": { en: "Text corrected", es: "Texto corregido" },
  "au.action_submission_reverted": { en: "Correction reverted", es: "Corrección revertida" },
  "au.action_submission_status_changed": { en: "Status changed", es: "Estado cambiado" },
  "au.action_staff_photos_added": { en: "Photos added", es: "Fotos agregadas" },
  "au.action_staff_photo_removed": { en: "Photo removed", es: "Foto quitada" },
  "au.action_photo_choice_changed": {
    en: "Photo choice changed",
    es: "Elección de fotos cambiada",
  },
  "au.action_story_check_changed": { en: "Check changed", es: "Verificación cambiada" },
  "au.action_story_planned": { en: "Date planned", es: "Fecha planificada" },
  "au.action_post_plan_viewed": { en: "Post plan viewed", es: "Plan de publicaciones visto" },
  "au.action_job_retried": { en: "Job retried", es: "Trabajo reintentado" },
  "au.action_job_discarded": { en: "Job discarded", es: "Trabajo descartado" },
  "au.action_jobs_retried_bulk": { en: "Jobs retried", es: "Trabajos reintentados" },
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
  "new.start": { en: "Start from", es: "Empezar desde" },
  "new.source": { en: "Form to duplicate", es: "Formulario a duplicar" },
  "new.source_missing": {
    en: "Choose a form to duplicate",
    es: "Elige un formulario para duplicar",
  },
  "new.title_en": { en: "Title in English", es: "Título en inglés" },
  "new.title_es": { en: "Title in Spanish", es: "Título en español" },
  "new.title_missing": {
    en: "Enter a title in each language the form uses",
    es: "Escribe un título en cada idioma que usa el formulario",
  },
  "new.slug_auto": {
    en: "Optional. Left empty, it is made from the title.",
    es: "Opcional. Si lo dejas vacío, se crea a partir del título.",
  },
  "new.slug_reserved": {
    en: "That link name is reserved. Choose another.",
    es: "Ese nombre de enlace está reservado. Elige otro.",
  },
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
