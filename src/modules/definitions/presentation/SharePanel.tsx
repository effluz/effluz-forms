import type { ShareInfo } from "../application";
import { Banner } from "@/shared/presentation/Banner";
import { Bilingual, BilingualText } from "@/shared/presentation/Bilingual";
import { bothLanguages, copy, fill, type CopyKey, type Text } from "@/shared/presentation/copy";
import { cx, styles } from "@/shared/presentation/styles";
import local from "./tabs.module.css";
import { formHref } from "./view-models";

const URL_ID = "share-url";

type Reason = NonNullable<ShareInfo["reason"]>;

/** The reason copy per unreachable state; see specs/ui-ux/manager.md, "Settings and share". */
const REASONS: Record<Reason, CopyKey> = {
  draft: "sh.reason_draft",
  closed: "sh.reason_closed",
  archived: "sh.reason_archived",
  not_open_yet: "sh.reason_not_open",
  past_close: "sh.reason_past_close",
};

/** Where the QR code is previewed and downloaded; see the routes under src/app/admin/forms/[id]. */
export function sharePaths(formId: string) {
  const base = formHref(formId);
  return {
    preview: `${base}/qr.svg`,
    pngSmall: `${base}/qr.png?size=1024`,
    pngLarge: `${base}/qr.png?size=2048`,
    svg: `${base}/qr.svg?download=1`,
  };
}

/** The unreachable warning in both languages, the reason filled in per language. */
function unreachableText(reason: Reason): Text {
  const why = copy[REASONS[reason]];
  const text = copy["sh.unreachable"];
  return { en: fill(text.en, { reason: why.en }), es: fill(text.es, { reason: why.es }) };
}

/**
 * The Share tab body: the public link, the QR code and its downloads, and a warning
 * when the public cannot open the form right now. See specs/ui-ux/manager.md, "Share tab".
 * The print sheet (PDF) has no link until it exists.
 */
export function SharePanel({ info, formId }: { info: ShareInfo; formId: string }) {
  const paths = sharePaths(formId);
  return (
    <section className={local.tab}>
      <h2 className={local.heading}>
        <Bilingual k="form.tab_share" />
      </h2>
      {info.reason === null ? null : (
        <Banner tone="warning">
          <BilingualText text={unreachableText(info.reason)} />
        </Banner>
      )}
      <div className={cx(styles.field, local.link)}>
        <label htmlFor={URL_ID} className={styles.label}>
          <Bilingual k="sh.url" />
        </label>
        <input
          id={URL_ID}
          className={styles.input}
          type="text"
          readOnly
          value={info.url}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <figure className={local.qr}>
        {/* The code is the link, so the description names the link a screen reader cannot scan. */}
        <img
          src={paths.preview}
          width={240}
          height={240}
          alt={`${bothLanguages(copy["sh.qr"])}: ${info.url}`}
        />
      </figure>
      <ul className={local.downloads}>
        <Download href={paths.pngSmall} k="sh.png_small" />
        <Download href={paths.pngLarge} k="sh.png_large" />
        <Download href={paths.svg} k="sh.svg" />
      </ul>
      <p className={local.note}>
        <Bilingual k="sh.stable" />
      </p>
    </section>
  );
}

function Download({ href, k }: { href: string; k: CopyKey }) {
  return (
    <li>
      <a className={styles.button} href={href} download>
        <Bilingual k={k} />
      </a>
    </li>
  );
}
