import type { ReactNode } from "react";
import { styles } from "./styles";

export type TabItem = {
  key: string;
  label: ReactNode;
  href: string;
  count?: number;
  current: boolean;
  /** A tab whose page does not exist yet: shown, but not a link. `current` wins. */
  disabled?: boolean;
};

/**
 * Tabs that are links to separate pages, so they work without JavaScript; the current
 * one carries `aria-current="page"`. Being links, they are not an ARIA tablist. See
 * design-system/components.md, "Tabs".
 */
export function Tabs(props: { items: TabItem[] }) {
  return (
    <div className={styles.tabs}>
      <ul>
        {props.items.map((item) => (
          <li key={item.key}>
            {/* The page being shown exists, so a current tab is always a link. */}
            {item.disabled && !item.current ? (
              // A placeholder until the page exists: without href it is not focusable.
              <a className={styles.tab} aria-disabled="true">
                <TabLabel item={item} />
              </a>
            ) : (
              <a
                className={styles.tab}
                href={item.href}
                {...(item.current ? { "aria-current": "page" as const } : {})}
              >
                <TabLabel item={item} />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TabLabel({ item }: { item: TabItem }) {
  return (
    <>
      {item.label}
      {item.count === undefined ? null : <span className={styles.count}>{item.count}</span>}
    </>
  );
}
