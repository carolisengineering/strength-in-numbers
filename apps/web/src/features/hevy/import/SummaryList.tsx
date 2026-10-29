import { useState } from "react";

import { Button } from "../../../ui/Button";
import type { ListRow } from "./importSummary";
import { SHOW_MORE } from "./messages";
import styles from "./ImportScreen.module.css";

const PAGE = 50;

/**
 * Spec 20.1 AC12: one list group, collapsed with its count; opened, it shows 50 rows at a time (**Show 50 more**), so
 * nothing is dropped silently and 1,000 rows are never drawn at once. Titles are rendered as text.
 */
export function SummaryList({ label, rows }: { label: string; rows: readonly ListRow[] }) {
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.group} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={styles.groupSummary}>{label}</summary>
      {open ? (
        <>
          <ul className={styles.rows}>
            {rows.slice(0, shown).map((row) => (
              <li key={row.id}>
                {row.date} · {row.title} · {row.reason}
              </li>
            ))}
          </ul>
          {shown < rows.length ? (
            <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
              {SHOW_MORE}
            </Button>
          ) : null}
        </>
      ) : null}
    </details>
  );
}
