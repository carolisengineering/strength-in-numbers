import { useState } from "react";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Sheet } from "../../ui/Sheet";
import { SECTION_STARTERS } from "./messages";
import { parseSectionName } from "./sectionText";
import styles from "./Sections.module.css";

export interface AddSectionSheetProps {
  open: boolean;
  onAdd: (name: string) => void;
  onClose: () => void;
}

/** Five one-tap starters and a free-text name (Spec 10.3 AC15, D5). A starter adds at once; every starter stays available. */
export function AddSectionSheet({ open, onAdd, onClose }: AddSectionSheetProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet open={open} title="Add section" onClose={onClose}>
      <div className={styles.form}>
        <div role="group" aria-label="Section names" className={styles.starters}>
          {SECTION_STARTERS.map((starter) => (
            <Button key={starter} variant="secondary" onClick={() => onAdd(starter)}>
              {starter}
            </Button>
          ))}
        </div>
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = parseSectionName(text);
            if (!parsed.ok) {
              setError(parsed.message);
              return;
            }
            onAdd(parsed.value);
          }}
        >
          <Field id="section-new-name" label="Name" {...(error ? { error } : {})}>
            {(control) => <input {...control} className={styles.input} autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />}
          </Field>
          <Button type="submit" block>
            Add
          </Button>
        </form>
      </div>
    </Sheet>
  );
}
