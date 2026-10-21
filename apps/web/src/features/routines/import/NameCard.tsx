import type { Equipment, Exercise, MuscleGroup } from "@sin/core";

import type { CardProblem, CardState } from "./cards";
import styles from "./ImportNames.module.css";
import { IN_YOUR_LIST, NOTHING_SIMILAR, SIMILAR, newOption, usedIn } from "./messages";

export interface NameCardProps {
  card: CardState;
  problem: CardProblem | undefined;
  visible: readonly Exercise[];
  /** The store's raw rows: a chosen exercise is named even if it has left `visible`. */
  rows: readonly Exercise[];
  muscleGroups: readonly MuscleGroup[] | undefined;
  equipment: readonly Equipment[] | undefined;
  onChange: (change: (card: CardState) => CardState) => void;
  onChooseAnother: () => void;
  /** The checked radio, for focus return. */
  registerSelected: (el: HTMLInputElement | null) => void;
}

/**
 * Spec 10.4 AC24–AC27, §5.3: one card per name — the name as written, where it is used, and its choice
 * as radios (the tag is text inside the label, never color alone). DOM ids come from the card's index.
 */
export function NameCard({ card, rows, onChange, registerSelected }: NameCardProps) {
  const radioName = `import-card-${card.index}-choice`;
  const nameOf = (id: string | null) => (id === null ? null : (rows.find((row) => row.id === id)?.name ?? null));
  const matchName = nameOf(card.match?.exerciseId ?? null);
  const newName = card.newValue.name.trim() === "" ? card.written : card.newValue.name.trim();
  const select = (selected: CardState["selected"]) => onChange((c) => ({ ...c, selected }));
  const radio = (selected: CardState["selected"]) => ({
    type: "radio" as const,
    name: radioName,
    checked: card.selected === selected,
    onChange: () => select(selected),
    ref: card.selected === selected ? registerSelected : undefined,
  });

  return (
    <fieldset className={styles.card} data-card={card.index} id={`import-card-${card.index}`}>
      <legend className={styles.written}>{card.written}</legend>
      {card.usedIn.length > 0 ? <p className={styles.usedIn}>{usedIn(card.usedIn)}</p> : null}
      {card.match === null ? <p className={styles.usedIn}>{NOTHING_SIMILAR}</p> : null}
      <div className={styles.options}>
        {card.match !== null && matchName !== null ? (
          <label className={styles.option}>
            <input {...radio("match")} />
            <span>{matchName}</span>
            <span className={styles.tag}>{card.match.kind === "exact" ? IN_YOUR_LIST : SIMILAR}</span>
          </label>
        ) : null}
        {card.match?.kind !== "exact" ? (
          <label className={styles.option}>
            <input {...radio("new")} />
            <span>{newOption(newName)}</span>
          </label>
        ) : null}
      </div>
    </fieldset>
  );
}
