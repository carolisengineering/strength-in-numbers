import type { HTMLAttributes, ReactNode } from "react";

import styles from "./ActionBar.module.css";

export interface ActionBarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/**
 * A screen's bottom action bar (design refresh, Stage 1): the last child of a `Screen`, holding its
 * thumb-zone buttons, each an equal share of the width. Pinned above the nav over a long list, at the
 * bottom of a short one. Status lines go in `ActionBarHint`.
 */
export function ActionBar({ children, className, ...rest }: ActionBarProps) {
  return (
    <div {...rest} data-action-bar="" className={[styles.bar, className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

/** A full-width status line under the bar's buttons. */
export function ActionBarHint({ children }: { children: ReactNode }) {
  return <p className={styles.hint}>{children}</p>;
}
