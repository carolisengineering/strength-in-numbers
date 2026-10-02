import type { ReactNode } from "react";

import { Button } from "./Button";
import styles from "./InlineNotice.module.css";

export interface InlineNoticeProps {
  tone?: "info" | "warning" | "error";
  children: ReactNode;
  /** Shown for support correlation (Spec 04.1's pattern). */
  requestId?: string | null;
  actionLabel?: string;
  onAction?: () => void;
  /** Given only for a message the reader may put away (a one-line notice, not an error to act on). */
  onDismiss?: () => void;
}

/**
 * An in-shell message (Spec 06.1 D12). Unlike `RetryScreen` it renders no `<main>` of its own, so it
 * can sit inside `AppShell`'s `<main>` without nesting landmarks. Errors and warnings are alerts
 * (announced at once); information is a polite status. The tone is also carried by a text prefix,
 * never by colour alone.
 */
export function InlineNotice({
  tone = "info",
  children,
  requestId,
  actionLabel,
  onAction,
  onDismiss,
}: InlineNoticeProps) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={tone === "info" ? "status" : "alert"}>
      <p className={styles.message}>{children}</p>
      {requestId ? <p className={styles.requestId}>Request ID: {requestId}</p> : null}
      {actionLabel && onAction ? (
        <Button variant="secondary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
      {onDismiss ? (
        <Button variant="secondary" onClick={onDismiss}>
          Dismiss
        </Button>
      ) : null}
    </div>
  );
}
