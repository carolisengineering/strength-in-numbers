import type { ReactNode } from "react";

import styles from "./FrontDoor.module.css";

export interface FrontDoorProps {
  /** The screen's test id, kept on the `main` (Spec 17.3 AC11). */
  testId: string;
  /** The line (`frontDoorStyles.line`) and the one bottom control. */
  children: ReactNode;
}

/** Class names for a front-door screen's children: the hairline line, the escape link, the login Button. */
export const frontDoorStyles = { line: styles.line, control: styles.control, login: styles.login };

/**
 * The unauthenticated front door (Spec 17.3): the "Strength in Numbers" title card that `Landing` and
 * `ResumingSession` share. The name is two authored lines; the space between the spans keeps the heading's
 * accessible name "Strength in Numbers". Outside `AppShell`, so it is its own full-viewport column, not `ui/Screen`.
 */
export function FrontDoor({ testId, children }: FrontDoorProps) {
  return (
    <main className={styles.frontDoor} data-testid={testId}>
      <div className={styles.column}>
        <div className={styles.top}>
          <h1 className={styles.name}>
            <span>Strength</span> <span>in Numbers</span>
          </h1>
        </div>
        <div className={styles.foot}>{children}</div>
      </div>
    </main>
  );
}
