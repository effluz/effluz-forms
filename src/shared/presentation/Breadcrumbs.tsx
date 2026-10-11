import type { ReactNode } from "react";
import { bothLanguages, copy } from "./copy";
import { cx, styles } from "./styles";

export type Crumb = { label: ReactNode; href?: string };

/**
 * The trail from Forms down to the current page, which is the last item.
 * See specs/ui-ux/manager.md, "Shell".
 */
export function Breadcrumbs(props: { items: Crumb[] }) {
  const last = props.items.length - 1;
  return (
    <nav aria-label={bothLanguages(copy["shell.breadcrumb"])} className={styles.breadcrumbs}>
      <ol>
        {props.items.map((item, i) => (
          // A page's trail is fixed, so the position is a stable key.
          <li key={i}>
            {i > 0 ? (
              <span aria-hidden="true" className={styles.crumbSeparator}>
                /
              </span>
            ) : null}
            <CrumbItem item={item} current={i === last} />
          </li>
        ))}
      </ol>
    </nav>
  );
}

function CrumbItem({ item, current }: { item: Crumb; current: boolean }) {
  const marked = current ? { "aria-current": "page" as const } : {};
  if (item.href === undefined) {
    return (
      <span {...marked} className={cx(current && styles.crumbCurrent) || undefined}>
        {item.label}
      </span>
    );
  }
  return (
    <a href={item.href} {...marked} className={cx(styles.link, current && styles.crumbCurrent)}>
      {item.label}
    </a>
  );
}
