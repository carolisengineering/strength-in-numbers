import type { ReactNode } from "react";
import { Link } from "react-router";

import styles from "./NavRow.module.css";

/**
 * Minor 553 (owner: b): a "go to the next screen" row, the second look for a link alone on its line beside `TextLink`.
 * Bold ink, 44 px tall, no underline; `chevron` adds a "›" that screen readers skip.
 */
export function NavRow({ to, children, chevron = false }: { to: string; children: ReactNode; chevron?: boolean }) {
  return (
    <Link className={styles.row} to={to}>
      {children}
      {chevron ? <span aria-hidden="true"> ›</span> : null}
    </Link>
  );
}
