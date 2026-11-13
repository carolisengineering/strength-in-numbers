import { useId, type ReactNode, type Ref } from "react";

import styles from "./Screen.module.css";

export interface ScreenProps {
  title: string;
  /** Rendered above the `<h1>`, at its own width (never stretched to a full-width tap target), e.g. a `BackLink` (#98). */
  lead?: ReactNode;
  /** The lead spans the screen's width: for a row that pairs a back link with a control at the far edge (#107). */
  leadFill?: boolean;
  children?: ReactNode;
  /** Spec 10.4: a screen that moves focus to its title on arrival passes a ref; the `<h1>` then takes `tabIndex={-1}`. */
  titleRef?: Ref<HTMLHeadingElement>;
  /**
   * Spec 17.13 AC10: the app header already says this word, so the `<h1>` is hidden from sight. It stays in the tree,
   * names the landmark and can take focus. Hidden at every width until Spec 17.12's desktop layout shows it.
   */
  hideTitle?: boolean;
  /** Spec 17.13 AC11: the `<h1>` one step smaller, under a larger title of the page's own (the summary's workout title). */
  titleSmall?: boolean;
}

/**
 * Page scaffold (Spec 04.1 §1, AC9): a `<section>` landmark labelled by its own
 * `<h1>`, so every screen has exactly one top-level heading and assistive tech
 * can jump to it by name. Width is capped at `--measure-max` and centred; on a
 * phone that is simply full width with the standard gutter.
 */
export function Screen({ title, lead, leadFill = false, children, titleRef, hideTitle = false, titleSmall = false }: ScreenProps) {
  const headingId = useId();
  const titleClass = [styles.title, hideTitle ? styles.titleHidden : null, titleSmall ? styles.titleSmall : null].filter(Boolean).join(" ");

  return (
    <section className={styles.screen} aria-labelledby={headingId}>
      {lead ? <div className={leadFill ? styles.leadFill : styles.lead}>{lead}</div> : null}
      <h1 className={titleClass} id={headingId} ref={titleRef} tabIndex={titleRef ? -1 : undefined}>
        {title}
      </h1>
      {children}
    </section>
  );
}
