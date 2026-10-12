import { fieldTypes } from "@/shared/domain/form-model";
import { UploadField } from "../client/UploadField";
import { t } from "../copy";
import { acceptAttribute, formatMegabytes, limitsKey } from "../format";
import { fileIssueMessage, filesCount } from "../messages";
import { styles } from "../styles";
import { hasHelp, HelpBlock, Star } from "./FieldShell";
import { type FieldRenderer, ids } from "./types";

const BYTES_PER_MB = 1024 * 1024;

/**
 * Files travel with the page post (`DecodedPost.incoming`), not as a decoded value, and the
 * staged ones are listed from the record, so this type has nothing to decode or encode.
 */
export const fileUpload: FieldRenderer = {
  decode: () => ({ value: undefined, issue: null }),
  encode: () => ({}),
  Component(props) {
    const settings = fieldTypes.file_upload.settingsSchema.parse(props.field.settings);
    const limits = {
      kinds: settings.kinds,
      maxFiles: settings.maxFiles,
      maxSizeMb: settings.maxSizeMb,
    };
    const { locale } = props;
    const key = props.field.key;
    const id = ids(key);
    const noticeId = `${key}-notice`;
    const limitsId = `${key}-limits`;
    const countId = `${key}-count`;
    const hasVideo = settings.kinds.includes("video");
    // "{file}" stays for the client, which fills it with the name of the file it refuses.
    const message = (code: "upload_failed" | "file_too_large" | "file_wrong_type"): string =>
      fileIssueMessage({ code, name: "{file}" }, limits, locale);
    const describedBy = [
      hasVideo ? noticeId : null,
      hasHelp(props) ? id.help : null,
      limitsId,
      countId,
      props.error ? id.error : null,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div className={styles.field} data-field={key}>
        {hasVideo ? (
          <p id={noticeId} className={styles.notice}>
            {t(locale, "video_notice")}
          </p>
        ) : null}
        <label htmlFor={id.control} className={styles.label}>
          {props.label}
          <Star required={props.required} />
        </label>
        <HelpBlock props={props} />
        <p id={limitsId} className={styles.hint}>
          {t(locale, limitsKey(settings.kinds), {
            size: formatMegabytes(settings.maxSizeMb, locale),
          })}
        </p>
        <UploadField
          slug={props.slug}
          fieldKey={key}
          inputId={id.control}
          errorId={id.error}
          countId={countId}
          describedBy={describedBy}
          accept={acceptAttribute(settings.kinds)}
          required={props.required}
          maxFiles={settings.maxFiles}
          maxBytes={settings.maxSizeMb * BYTES_PER_MB}
          kinds={settings.kinds}
          error={props.error}
          initial={[...props.files]}
          initialCount={filesCount(props.files.length, settings.maxFiles, locale)}
          text={{
            chooseFiles: t(locale, "choose_files"),
            uploading: t(locale, "uploading"),
            uploaded: t(locale, "uploaded"),
            uploadingFile: t(locale, "file_uploading"),
            uploadedFile: t(locale, "file_uploaded"),
            remove: t(locale, "remove"),
            retry: t(locale, "retry"),
            removed: t(locale, "removed"),
            removeFailed: t(locale, "remove_failed"),
            count: t(locale, "files_count"),
            countOne: t(locale, "files_count_one"),
            failed: message("upload_failed"),
            tooLarge: message("file_too_large"),
            wrongType: message("file_wrong_type"),
          }}
          locale={locale}
        />
      </div>
    );
  },
};
