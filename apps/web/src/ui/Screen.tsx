import { useId, type ReactNode } from "react";

import styles from "./Screen.module.css";

export interface ScreenProps {
  title: string;
  /** Rendered above the `<h1>`, at its own width (never stretched to a full-width tap target), e.g. a `BackLink` (#98). */
  lead?: ReactNode;
  children?: ReactNode;
}

/**
 * Page scaffold (Spec 04.1 §1, AC9): a `<section>` landmark labelled by its own
 * `<h1>`, so every screen has exactly one top-level heading and assistive tech
 * can jump to it by name. Width is capped at `--measure-max` and centred; on a
 * phone that is simply full width with the standard gutter.
 */
export function Screen({ title, lead, children }: ScreenProps) {
  const headingId = useId();

  return (
    <section className={styles.screen} aria-labelledby={headingId}>
      {lead ? <div className={styles.lead}>{lead}</div> : null}
      <h1 className={styles.title} id={headingId}>
        {title}
      </h1>
      {children}
    </section>
  );
}
