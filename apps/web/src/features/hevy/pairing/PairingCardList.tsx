import { useEffect, useMemo, useState } from "react";

import { ExercisePicker } from "../../catalog/ExercisePicker";
import { useEquipment, useMuscleGroups } from "../../catalog/referenceData";
import { useCatalog } from "../../catalog/useCatalog";
import { PairingCard } from "./PairingCard";
import { decisionsOf, validity, type PairingCard as PairingCardState, type PairingDecision, type PairingNeed } from "./pairingCards";
import styles from "./PairingCardList.module.css";

export interface PairingCardsProps {
  needs: readonly PairingNeed[];
  cards: PairingCardState[];
  onCardsChange: (cards: PairingCardState[]) => void;
  onValidityChange?: (v: { valid: boolean; decisions: PairingDecision[] }) => void;
}

/**
 * Spec 20.0 AC26, AC27, AC29: the shared pairing component for 20.1 and 20.2. Controlled: the parent owns the cards
 * and decides when to save (`savePairings`); unmounting it creates and writes nothing. "Choose another…" opens the
 * exercise picker with no create row.
 */
export function PairingCards({ needs, cards, onCardsChange, onValidityChange }: PairingCardsProps) {
  const { state, visible } = useCatalog();
  const muscles = useMuscleGroups();
  const equipment = useEquipment();
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const checked = useMemo(() => validity(cards, visible), [cards, visible]);
  const missing = useMemo(() => new Set(needs.filter((n) => n.missing).map((n) => n.template.id)), [needs]);
  useEffect(() => {
    onValidityChange?.({ valid: checked.valid, decisions: checked.valid ? decisionsOf(cards, needs) : [] });
  }, [checked, cards, needs, onValidityChange]);

  const update = (templateId: string, change: (card: PairingCardState) => PairingCardState) =>
    onCardsChange(cards.map((c) => (c.templateId === templateId ? change(c) : c)));

  return (
    <div className={styles.cards}>
      {cards.map((card) => (
        <PairingCard
          key={card.templateId}
          card={card}
          problem={checked.problems.get(card.templateId)}
          missing={missing.has(card.templateId)}
          rows={state.rows}
          muscleGroups={muscles.data}
          equipment={equipment.data}
          onChange={(change) => update(card.templateId, change)}
          onChooseAnother={() => setPickerFor(card.templateId)}
        />
      ))}
      <ExercisePicker
        open={pickerFor !== null}
        allowCreate={false}
        onPick={(exercise) => {
          const id = pickerFor;
          if (id === null) return;
          // Picking the exercise the card already matched selects the match rather than listing it twice.
          update(id, (c) => (c.match?.exerciseId === exercise.id ? { ...c, pickedId: null, selected: "match" } : { ...c, pickedId: exercise.id, selected: "picked" }));
          setPickerFor(null);
        }}
        onClose={() => setPickerFor(null)}
      />
    </div>
  );
}
