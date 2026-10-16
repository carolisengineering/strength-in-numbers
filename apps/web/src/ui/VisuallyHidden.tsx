import type { ReactNode } from "react";

import styles from "./VisuallyHidden.module.css";

/** Text for assistive technology only: in the accessibility tree, off the screen (never `display: none`). */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className={styles.hidden}>{children}</span>;
}
