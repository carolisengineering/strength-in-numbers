import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import styles from "./Sections.module.css";

export interface MoveToSectionSheetProps {
  open: boolean;
  title: string;
  /** The item's current section key; `null` = loose. Shown selected and disabled. */
  current: string | null;
  sections: readonly { key: string; name: string }[];
  onChoose: (sectionKey: string | null) => void;
  onClose: () => void;
}

/** "Move to section…" (Spec 10.3 AC18): No section and every section by name; choosing one closes the sheet. */
export function MoveToSectionSheet({ open, title, current, sections, onChoose, onClose }: MoveToSectionSheetProps) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <ul className={styles.choices} aria-label="Sections">
        <li>
          <Button variant="secondary" block disabled={current === null} {...(current === null ? { "aria-current": "true" as const } : {})} onClick={() => onChoose(null)}>
            No section{current === null ? " (current)" : ""}
          </Button>
        </li>
        {sections.map((section) => (
          <li key={section.key}>
            <Button variant="secondary" block disabled={current === section.key} {...(current === section.key ? { "aria-current": "true" as const } : {})} onClick={() => onChoose(section.key)}>
              {section.name}
              {current === section.key ? " (current)" : ""}
            </Button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
