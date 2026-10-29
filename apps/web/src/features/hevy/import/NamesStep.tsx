import { useCallback, type Ref } from "react";

import { Button } from "../../../ui/Button";
import { useCatalog } from "../../catalog/useCatalog";
import { PairingCards } from "../pairing";
import type { ImportAction, ImportState } from "./importSession";
import { customExerciseRoom } from "./importNeeds";
import { BACK, CONTINUE, createsLine, creatingLine, NAMES_TITLE } from "./messages";
import styles from "./ImportScreen.module.css";

/**
 * Spec 20.1 AC9, AC10, §5.4: 20.0's pairing cards for the templates the mapping lacks. The header says how many
 * exercises the choices would create against the 500 cap; **Continue** saves (creates first, then the pairs) and is
 * off while a card is invalid or the creates don't fit. The cards stay as chosen if the save fails.
 */
export function NamesStep({
  state,
  dispatch,
  onSave,
  onBack,
  headingRef,
}: {
  state: ImportState;
  dispatch: (action: ImportAction) => void;
  onSave: () => void;
  onBack: (() => void) | null;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const { visible } = useCatalog();
  const saving = state.step === "saving_names";
  const creates = state.decisions !== null ? state.decisions.filter((d) => d.action === "create").length : state.cards.filter((c) => c.selected === "new").length;
  const roomLeft = customExerciseRoom(visible);
  const blocked = state.decisions === null || creates > roomLeft;
  // Stable: PairingCards reports validity from an effect that depends on this callback.
  const onCardsChange = useCallback((cards: ImportState["cards"]) => dispatch({ type: "namesCards", cards }), [dispatch]);
  const onValidityChange = useCallback(
    (v: { valid: boolean; decisions: NonNullable<ImportState["decisions"]> }) => dispatch({ type: "namesValidity", ...v }),
    [dispatch],
  );

  return (
    <section className={styles.step} aria-labelledby="hevy-import-step">
      <h2 className={styles.stepTitle} id="hevy-import-step" ref={headingRef} tabIndex={-1}>
        {NAMES_TITLE}
      </h2>
      <p className={styles.text}>{createsLine(creates, roomLeft)}</p>
      {state.namesError !== null ? (
        <p className={styles.failure} role="alert">
          {state.namesError}
        </p>
      ) : null}
      {saving ? null : (
        <PairingCards
          needs={state.needs}
          cards={state.cards}
          onCardsChange={onCardsChange}
          onValidityChange={onValidityChange}
        />
      )}
      <p className={styles.status} role="status">
        {saving ? creatingLine(state.namesProgress?.created ?? 0, state.namesProgress?.total ?? creates) : ""}
      </p>
      <div className={styles.actions}>
        {onBack && !saving ? (
          <Button variant="secondary" onClick={onBack}>
            {BACK}
          </Button>
        ) : null}
        <Button onClick={onSave} disabled={blocked && !saving} busy={saving}>
          {CONTINUE}
        </Button>
      </div>
    </section>
  );
}
