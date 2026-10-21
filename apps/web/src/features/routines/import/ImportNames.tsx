import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { ExercisePicker } from "../../catalog/ExercisePicker";
import { useEquipment, useMuscleGroups } from "../../catalog/referenceData";
import { useCatalog } from "../../catalog/useCatalog";
import { BackLink } from "../../../ui/BackLink";
import { ActionBar, ActionBarHint } from "../../../ui/ActionBar";
import { Button } from "../../../ui/Button";
import { InlineNotice } from "../../../ui/InlineNotice";
import { Screen } from "../../../ui/Screen";
import { IMPORT_EDIT_PATH, IMPORT_PATH } from "../paths";
import { cardNames, cardProblems, initialCards } from "./cards";
import styles from "./ImportNames.module.css";
import { useImportSession } from "./ImportSession";
import { buildHandoff } from "./handoff";
import {
  BACK_TO_TEXT,
  CATALOG_FAILED,
  CATALOG_LOADING,
  CONTINUE,
  GO_TO_FIRST,
  NAMES_TITLE,
  needAttention,
  summaryLine,
} from "./messages";
import { NameCard } from "./NameCard";

const REASON_ID = "import-continue-reason";

/**
 * Spec 10.4 §5.3, AC23–AC28: one card per exercise name, decided against a synced catalog. Nothing is
 * created here; Continue hands the choices to the editor.
 */
export function ImportNames() {
  const session = useImportSession();
  const read = session.read?.result ?? null;
  if (read === null || cardNames(read).length === 0) return <Navigate to={IMPORT_PATH} replace />;
  return <NamesBody />;
}

function NamesBody() {
  const session = useImportSession();
  const read = session.read!.result;
  const navigate = useNavigate();
  const { state, visible, refresh } = useCatalog();
  const muscles = useMuscleGroups();
  const equipment = useEquipment();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // AC23: classify only against a synced catalog (or cached rows); an empty, never-synced store waits.
  const waiting = state.rows.length === 0 && state.lastRefreshAt === null;

  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const selectedRadios = useRef(new Map<string, HTMLInputElement>());
  // The picker's <dialog> restores focus to its opener on close; a pick moves it to the card's new checked
  // radio instead, so this runs after the Sheet's own effect (child effects run first).
  const focusAfterPick = useRef<string | null>(null);
  useEffect(() => {
    const key = focusAfterPick.current;
    if (key === null) return;
    focusAfterPick.current = null;
    selectedRadios.current.get(key)?.focus();
  });

  useEffect(() => titleRef.current?.focus(), []);

  useEffect(() => {
    if (!waiting && session.cards === null) session.setCards(initialCards(cardNames(read), visible));
  }, [waiting, session, read, visible]);

  const cards = session.cards;
  const problems = useMemo(() => (cards ? cardProblems(cards, visible) : new Map()), [cards, visible]);
  const blocked = cards?.filter((card) => problems.has(card.key)) ?? [];

  const goToFirst = () => {
    const first = blocked[0];
    if (!first) return;
    const target =
      document.getElementById(`import-card-${first.index}-new-name`) ??
      selectedRadios.current.get(first.key) ??
      document.querySelector<HTMLInputElement>(`#import-card-${first.index} input`);
    target?.focus();
  };

  const continueToEditor = () => {
    if (cards === null || blocked.length > 0) return;
    session.setHandoff(buildHandoff({ read, cards, rows: state.rows, placeholderFor: session.placeholderFor }));
    navigate(IMPORT_EDIT_PATH);
  };

  return (
    <Screen title={NAMES_TITLE} titleRef={titleRef} lead={<BackLink to={IMPORT_PATH} label={BACK_TO_TEXT} />}>
      {waiting && state.status === "error" ? (
        <InlineNotice tone="error" actionLabel="Retry" onAction={() => void refresh(true)}>
          {CATALOG_FAILED}
        </InlineNotice>
      ) : null}
      {waiting && state.status !== "error" ? (
        <p role="status" className={styles.status}>
          {CATALOG_LOADING}
        </p>
      ) : null}
      {!waiting && cards !== null ? (
        <>
          <p className={styles.summary}>{summaryLine(read.sections.length, cards.length, read.chunks)}</p>
          <div className={styles.cards}>
            {cards.map((card) => (
              <NameCard
                key={card.key}
                card={card}
                problem={problems.get(card.key)}
                visible={visible}
                rows={state.rows}
                muscleGroups={muscles.data}
                equipment={equipment.data}
                onChange={(change) => session.updateCard(card.key, change)}
                onChooseAnother={() => setPickerFor(card.key)}
                registerSelected={(el) => {
                  if (el) selectedRadios.current.set(card.key, el);
                  else selectedRadios.current.delete(card.key);
                }}
              />
            ))}
          </div>
          <ActionBar>
            <Button disabled={blocked.length > 0} aria-describedby={blocked.length > 0 ? REASON_ID : undefined} onClick={continueToEditor}>
              {CONTINUE}
            </Button>
            {blocked.length > 0 ? (
              <ActionBarHint>
                <span id={REASON_ID}>{needAttention(blocked.length)}</span>{" "}
                <button type="button" className={styles.linkButton} onClick={goToFirst}>
                  {GO_TO_FIRST}
                </button>
              </ActionBarHint>
            ) : null}
          </ActionBar>
        </>
      ) : null}
      <ExercisePicker
        open={pickerFor !== null}
        allowCreate={false}
        onPick={(exercise) => {
          const key = pickerFor;
          if (key === null) return;
          session.updateCard(key, (c) => ({ ...c, pickedId: exercise.id, selected: "picked" }));
          focusAfterPick.current = key;
          setPickerFor(null);
        }}
        onClose={() => setPickerFor(null)}
      />
    </Screen>
  );
}
