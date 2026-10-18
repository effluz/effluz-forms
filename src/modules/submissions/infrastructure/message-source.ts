import { loadForm, type DefinitionsDeps } from "@/modules/definitions/application";
import type {
  MessageSource,
  StaffNotificationData,
  SubmitterConfirmationData,
} from "@/modules/notifications/application";
import type { FieldTypeRegistry } from "@/shared/domain/form-model";
import { resolveText, type Locale } from "@/shared/domain/localized-text";
import type { SubmissionRepository } from "../application/ports/submission-repository";
import type { VersionCache } from "../application/version-cache";
import { submitterAddress } from "../domain/intake";

/** The submitter's received date, for example `10 de octubre de 2026`. */
function receivedOn(at: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone }).format(at);
}

function clockParts(at: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** The staff received time: `YYYY-MM-DD HH:mm <zone>, HH:mm UTC` (specs/system/email.md, "Staff notification, fixed parts"). */
function receivedAt(at: Date, timeZone: string): string {
  const local = clockParts(at, timeZone);
  const utc = clockParts(at, "UTC");
  return (
    `${local["year"] ?? ""}-${local["month"] ?? ""}-${local["day"] ?? ""} ` +
    `${local["hour"] ?? ""}:${local["minute"] ?? ""} ${timeZone}, ` +
    `${utc["hour"] ?? ""}:${utc["minute"] ?? ""} UTC`
  );
}

/**
 * The data the two email jobs need, read at run time from a submission id
 * (specs/system/jobs.md, "Handler rules"; specs/system/email.md, "Ports").
 * Null means there is nothing to send.
 */
export class SubmissionMessageSource implements MessageSource {
  constructor(
    private readonly deps: {
      submissions: SubmissionRepository;
      definitions: DefinitionsDeps;
      versions: VersionCache;
      registry: FieldTypeRegistry;
      publicBaseUrl: string;
      privacyContact: string;
    },
  ) {}

  async submitterConfirmation(
    submissionId: string,
  ): Promise<{ to: string; data: SubmitterConfirmationData } | null> {
    const { deps } = this;
    const submission = await deps.submissions.findById(submissionId);
    if (!submission) return null;
    const form = await loadForm(deps.definitions, submission.formId);
    const version = await deps.versions.get(deps.definitions, submission.versionId);
    if (!form || !version) return null;
    const doc = version.document;
    const email = doc.confirmation.email;
    if (!email) return null;
    const to = submitterAddress(doc, deps.registry, submission.answers);
    if (to === null) return null;
    const { locale } = submission;
    return {
      to,
      data: {
        locale,
        formTitle: resolveText(doc.title, locale, doc.languages),
        subject: resolveText(email.subject, locale, doc.languages),
        body: resolveText(email.body, locale, doc.languages),
        receivedOn: receivedOn(submission.receivedAt, locale, form.settings.timezone),
        reference: submission.reference,
        retentionMonths: form.settings.retentionMonths,
        contact: deps.privacyContact,
      },
    };
  }

  async staffNotification(
    submissionId: string,
  ): Promise<{ to: string[]; data: StaffNotificationData } | null> {
    const { deps } = this;
    const submission = await deps.submissions.findById(submissionId);
    if (!submission) return null;
    const form = await loadForm(deps.definitions, submission.formId);
    if (!form) return null;
    const { settings } = form;
    if (settings.notificationCadence !== "per_submission") return null;
    if (settings.notificationRecipients.length === 0) return null;
    return {
      to: [...settings.notificationRecipients],
      data: {
        formTitle: resolveText(form.title, "en", form.languages),
        reference: submission.reference,
        receivedAt: receivedAt(submission.receivedAt, settings.timezone),
        // The story page; opening it records the first view.
        link: `${deps.publicBaseUrl}/admin/forms/${form.id}/submissions/${submission.reference}`,
      },
    };
  }
}
