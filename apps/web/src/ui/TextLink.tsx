import type { ReactNode } from "react";
import { Link } from "react-router";

import styles from "./TextLink.module.css";

/**
 * Spec 17.13 AC15 (D4): a link alone on its line is a full tap target, 44 px tall and only as wide as its words (#98:
 * never stretched into a full-width target). A link inside running text stays plain text and is the one exemption.
 */
export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className={styles.link} to={to}>
      {children}
    </Link>
  );
}
