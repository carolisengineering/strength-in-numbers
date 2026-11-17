import type { MouseEvent } from "react";
import { Link } from "react-router";

import styles from "./BackLink.module.css";
import { usePane } from "./paneContext";

export interface BackLinkProps {
  to: string;
  /** The whole accessible name, e.g. "Back to Workouts"; the chevron is decorative. */
  label: string;
  /** Runs before the link navigates; `preventDefault()` keeps it from pushing `to` (a caller that went Back itself). */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * A "‹ Back to …" text link for `Screen`'s `lead` slot (#98): a 44 px tap target in the interactive color. Not drawn
 * in a detail pane (Spec 17.12 AC17): the list beside it is the way back.
 */
export function BackLink({ to, label, onClick }: BackLinkProps) {
  const { slot } = usePane();
  if (slot === "detail") return null;
  return (
    <Link className={styles.back} to={to} onClick={onClick}>
      <span aria-hidden="true">‹</span>
      {label}
    </Link>
  );
}
