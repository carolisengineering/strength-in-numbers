import type { Equipment, Exercise, MuscleGroup } from "@sin/core";

import { Button } from "../../../ui/Button";
import { ExerciseFields } from "../../catalog/ExerciseFields";
import { HEVY_TYPE_LABELS } from "../labels";
import {
  ASSIST_RULE,
  CALORIES_RULE,
  CHOOSE_ANOTHER,
  EXACT_MATCH,
  NEW_EXERCISE,
  NEW_INVALID,
  NO_LONGER_IN_HEVY,
  PAIRING_GONE,
  RULE_NEEDED,
  RULE_NOT_ALLOWED,
  SAME_NEW_NAME,
  newNameExists,
  SIMILAR_MATCH,
  SKIP_EXERCISE,
  UNSUPPORTED_TYPE,
  typeProblem,
  usedIn,
} from "../messages";
import { setRule, type PairingCard as PairingCardState, type PairingProblem } from "./pairingCards";
import styles from "./PairingCard.module.css";

export interface PairingCardProps {
  card: PairingCardState;
  problem: PairingProblem | undefined;
  missing: boolean;
  /** The store's raw rows: a chosen exercise is named even if it has left the list. */
  rows: readonly Exercise[];
  muscleGroups: readonly MuscleGroup[] | undefined;
  equipment: readonly Equipment[] | undefined;
  onChange: (change: (card: PairingCardState) => PairingCardState) => void;
  onChooseAnother: () => void;
}

function problemText(problem: PairingProblem): string | null {
  switch (problem.kind) {
    case "type":
      return typeProblem(problem.hevyLabel, problem.modalityLabel);
    case "rule_needed":
      return RULE_NEEDED;
    case "rule_not_allowed":
      return RULE_NOT_ALLOWED;
    case "same-new":
      return SAME_NEW_NAME;
    case "exists":
      return newNameExists(problem.exerciseName);
    case "invalid":
      return NEW_INVALID;
    case "gone":
      return PAIRING_GONE;
    case "unsupported":
      return UNSUPPORTED_TYPE;
    case "name":
      return null; // shown on the name field itself
  }
}

/**
 * Spec 20.0 AC26, §5.4: one Hevy exercise — its title, type and use — and its choice as radios: the match, a chosen
 * exercise, a new one, or Skip. The tag is text inside the label, never color alone. A proposed rule is a checkbox
 * that starts ticked. Nothing is created or written here. DOM ids come from the card's index, never the Hevy title.
 */
export function PairingCard({ card, problem, missing, rows, muscleGroups, equipment, onChange, onChooseAnother }: PairingCardProps) {
  const radioName = `hevy-card-${card.index}-choice`;
  const nameOf = (id: string | null) => (id === null ? null : (rows.find((row) => row.id === id)?.name ?? null));
  const matchName = nameOf(card.match?.exerciseId ?? null);
  const pickedName = card.selected === "picked" ? nameOf(card.pickedId) : null;
  const radio = (selected: PairingCardState["selected"]) => ({
    type: "radio" as const,
    name: radioName,
    checked: card.selected === selected,
    onChange: () => onChange((c) => ({ ...c, selected })),
  });
  // The rule the card proposes: its own suggestion, or the one its current choice needs.
  const offered = card.ruleSuggested ?? (problem?.kind === "rule_needed" ? problem.rule : null) ?? (card.rule ?? null);
  const message = problem ? problemText(problem) : null;

  return (
    <fieldset className={styles.card} id={`hevy-card-${card.index}`}>
      <legend className={styles.title}>{card.title}</legend>
      <p className={styles.meta}>
        {card.hevyType !== null ? HEVY_TYPE_LABELS[card.hevyType] : null}
        {missing ? <span className={styles.tag}>{` · ${NO_LONGER_IN_HEVY}`}</span> : null}
        {card.context ? ` · ${usedIn(card.context.workouts, card.context.routines)}` : null}
      </p>
      <div className={styles.options}>
        {card.match !== null && matchName !== null ? (
          <label className={styles.option}>
            <input {...radio("match")} disabled={card.hevyType === null} />
            <span>{matchName}</span>{" "}
            <span className={styles.tag}>{card.match.kind === "exact" ? EXACT_MATCH : SIMILAR_MATCH}</span>
          </label>
        ) : null}
        {card.pickedId !== null && pickedName !== null ? (
          <label className={styles.option}>
            <input {...radio("picked")} />
            <span>{pickedName}</span>
          </label>
        ) : null}
        {card.hevyType !== null ? (
          <label className={styles.option}>
            <input {...radio("new")} />
            <span>{NEW_EXERCISE}</span>
          </label>
        ) : null}
        <label className={styles.option}>
          <input {...radio("skip")} />
          <span>{SKIP_EXERCISE}</span>
        </label>
      </div>
      {card.selected === "new" ? (
        <ExerciseFields
          values={card.newValue}
          onChange={(newValue) => onChange((c) => ({ ...c, newValue }))}
          errors={problem?.kind === "name" ? { name: problem.message } : {}}
          idPrefix={`hevy-card-${card.index}-new`}
          muscleGroups={muscleGroups}
          equipment={equipment}
          detailsOpen={card.detailsOpen}
          onDetailsOpenChange={(detailsOpen) => onChange((c) => ({ ...c, detailsOpen }))}
        />
      ) : null}
      {card.selected !== "skip" && offered !== null ? (
        <label className={styles.option}>
          <input type="checkbox" checked={card.rule === offered} onChange={(e) => onChange((c) => setRule(c, e.target.checked ? offered : null))} />
          <span>{offered === "calories_as_reps" ? CALORIES_RULE : ASSIST_RULE}</span>
        </label>
      ) : null}
      {message !== null ? (
        <p className={styles.problem} role="status">
          {message}
        </p>
      ) : null}
      {card.hevyType !== null ? (
        <Button variant="secondary" aria-label={`${CHOOSE_ANOTHER} for ${card.title}`} onClick={onChooseAnother}>
          {CHOOSE_ANOTHER}
        </Button>
      ) : null}
    </fieldset>
  );
}
