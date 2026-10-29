import type { Equipment, Exercise, MuscleGroup } from "@sin/core";
import { useEffect, useRef } from "react";

import { ExerciseFields } from "../../catalog/ExerciseFields";
import { Button } from "../../../ui/Button";
import { chooseExisting, type CardProblem, type CardState } from "./cards";
import styles from "./ImportNames.module.css";
import {
  CHANGE,
  CHOOSE_ANOTHER,
  EXERCISE_GONE,
  IN_YOUR_LIST,
  NOTHING_SIMILAR,
  SAME_NEW,
  NEW_DETAILS_INVALID,
  SIMILAR,
  TYPE_LABEL,
  USE_IT_INSTEAD,
  alreadyInList,
  newOption,
  usedIn,
} from "./messages";

export interface NameCardProps {
  card: CardState;
  problem: CardProblem | undefined;
  visible: readonly Exercise[];
  /** An exercise's name from the store's raw rows, so a chosen exercise is named even if it has left `visible`. */
  exerciseName: (id: string | null) => string | null;
  muscleGroups: readonly MuscleGroup[] | undefined;
  equipment: readonly Equipment[] | undefined;
  onChange: (change: (card: CardState) => CardState) => void;
  onChooseAnother: () => void;
  /** The checked radio, for focus return. */
  registerSelected: (el: HTMLInputElement | null) => void;
}

/**
 * Spec 10.4 AC24–AC27, §5.3: one card per name — the name as written, where it is used, and its choice
 * as radios (the tag is text inside the label, never color alone). New shows the create-exercise fields;
 * nothing is created here. DOM ids come from the card's index, never from the pasted text.
 */
export function NameCard({ card, problem, exerciseName, muscleGroups, equipment, onChange, onChooseAnother, registerSelected }: NameCardProps) {
  const radioName = `import-card-${card.index}-choice`;
  const matchName = exerciseName(card.match?.exerciseId ?? null);
  const pickedName = card.selected === "picked" ? exerciseName(card.pickedId) : null;
  const newName = card.newValue.name.trim() === "" ? card.written : card.newValue.name.trim();
  const checked = useRef<HTMLInputElement | null>(null);
  const focusChecked = useRef(false);

  // After "Use it instead" the checked radio is a different element; focus it once it exists.
  useEffect(() => {
    if (!focusChecked.current) return;
    focusChecked.current = false;
    checked.current?.focus();
  });

  const radio = (selected: CardState["selected"]) => ({
    type: "radio" as const,
    name: radioName,
    checked: card.selected === selected,
    onChange: () => onChange((c) => ({ ...c, selected })),
    ref:
      card.selected === selected
        ? (el: HTMLInputElement | null) => {
            checked.current = el;
            registerSelected(el);
          }
        : undefined,
  });

  const nameNotice =
    problem?.kind === "exists" ? (
      <div className={styles.notice} role="status">
        <p>{alreadyInList(problem.exercise.name)}</p>
        <Button
          variant="secondary"
          aria-label={`${USE_IT_INSTEAD}: ${problem.exercise.name}`}
          onClick={() => {
            focusChecked.current = true;
            onChange((c) => chooseExisting(c, problem.exercise));
          }}
        >
          {USE_IT_INSTEAD}
        </Button>
      </div>
    ) : problem?.kind === "same-new" ? (
      <p className={styles.notice} role="status">
        {SAME_NEW}
      </p>
    ) : problem?.kind === "invalid" ? (
      <p className={styles.notice} role="status">
        {NEW_DETAILS_INVALID}
      </p>
    ) : null;

  return (
    <fieldset className={styles.card} data-card={card.index} id={`import-card-${card.index}`}>
      <legend className={styles.written}>{card.written}</legend>
      {card.usedIn.length > 0 ? <p className={styles.usedIn}>{usedIn(card.usedIn)}</p> : null}
      {card.match === null ? <p className={styles.usedIn}>{NOTHING_SIMILAR}</p> : null}
      {problem?.kind === "gone" ? (
        <p className={styles.notice} role="status">
          {EXERCISE_GONE}
        </p>
      ) : null}
      <div className={styles.options}>
        {card.match !== null && matchName !== null ? (
          <label className={styles.option}>
            <input {...radio("match")} />
            <span>{matchName}</span>
            <span className={styles.tag}>{card.match.kind === "exact" ? IN_YOUR_LIST : SIMILAR}</span>
          </label>
        ) : null}
        {card.pickedId !== null && pickedName !== null ? (
          <div className={styles.picked}>
            <label className={styles.option}>
              <input {...radio("picked")} />
              <span>{pickedName}</span>
            </label>
            <Button variant="secondary" aria-label={`${CHANGE}: ${pickedName}`} onClick={onChooseAnother}>
              {CHANGE}
            </Button>
          </div>
        ) : null}
        {card.match?.kind !== "exact" || card.match.chosen || matchName === null ? (
          <label className={styles.option}>
            <input {...radio("new")} />
            <span>{newOption(newName)}</span>
          </label>
        ) : null}
      </div>
      {card.selected === "new" ? (
        <div className={styles.fields}>
          <ExerciseFields
            values={card.newValue}
            onChange={(newValue) => onChange((c) => ({ ...c, newValue }))}
            errors={problem?.kind === "name" ? { name: problem.message } : {}}
            idPrefix={`import-card-${card.index}-new`}
            modalityLabel={TYPE_LABEL}
            muscleGroups={muscleGroups}
            equipment={equipment}
            detailsOpen={card.detailsOpen}
            onDetailsOpenChange={(detailsOpen) => onChange((c) => ({ ...c, detailsOpen }))}
            nameNotice={nameNotice}
          />
        </div>
      ) : null}
      <Button variant="secondary" aria-label={`${CHOOSE_ANOTHER} for ${card.written}`} onClick={onChooseAnother}>
        {CHOOSE_ANOTHER}
      </Button>
    </fieldset>
  );
}
