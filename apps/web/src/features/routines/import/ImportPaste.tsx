import { IMPORT_TEXT_MAX, ROUTINES_PER_USER_MAX, readWorkoutText, type ReadResult } from "@sin/core";
import { useState } from "react";
import { useNavigate } from "react-router";

import { ActionBar } from "../../../ui/ActionBar";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { InlineNotice } from "../../../ui/InlineNotice";
import { Screen } from "../../../ui/Screen";
import { LIMIT_MESSAGE } from "../messages";
import { IMPORT_EDIT_PATH, IMPORT_NAMES_PATH } from "../paths";
import { useRoutines } from "../queries";
import { BackToWorkouts } from "../RoutinePreview";
import styles from "./ImportPaste.module.css";
import { cardNames } from "./cards";
import { emptyHandoff } from "./handoff";
import { useImportSession } from "./ImportSession";
import {
  HOW_TO_INTRO,
  HOW_TO_STEPS,
  NO_EXERCISES,
  NOTHING_TO_READ,
  OPEN_ANYWAY,
  PASTE_TITLE,
  PRIVACY_LINE,
  READ_BUTTON,
  TEXT_LABEL,
  TOO_LONG,
  foundLine,
} from "./messages";

const LIMIT_ID = "import-limit-text";
const HOW_TO_ID = "import-how-to";

/** Spec 10.4 §5.2, AC19, AC21–AC22: paste the Live Text, then Read workout. Nothing is saved here. */
export function ImportPaste() {
  const session = useImportSession();
  const navigate = useNavigate();
  const routines = useRoutines();
  const [tooLong, setTooLong] = useState(false);
  /** AC22: the last read found no exercises (null = no such read on screen). */
  const [empty, setEmpty] = useState<ReadResult | null>(null);
  const atLimit = routines.data !== undefined && routines.data.length >= ROUTINES_PER_USER_MAX;
  const blank = session.text.trim() === "";

  const readText = () => {
    const text = session.text;
    if (text.length > IMPORT_TEXT_MAX) {
      setTooLong(true);
      return;
    }
    const result = readWorkoutText(text);
    session.commitRead(text, result);
    // AC22: exercises the routine would leave out (past the section or item caps) do not count.
    if (cardNames(result).length > 0) navigate(IMPORT_NAMES_PATH);
    else setEmpty(result);
  };

  const openAnyway = (result: ReadResult) => {
    session.setHandoff(emptyHandoff(result));
    navigate(IMPORT_EDIT_PATH);
  };

  return (
    <Screen title={PASTE_TITLE} lead={<BackToWorkouts />}>
      <Field id="import-text" label={TEXT_LABEL}>
        {(control) => (
          <textarea
            {...control}
            className={styles.text}
            value={session.text}
            onChange={(event) => {
              session.setText(event.target.value);
              setTooLong(false);
              setEmpty(null);
            }}
          />
        )}
      </Field>
      {tooLong ? (
        <p className={styles.alert} role="alert">
          {TOO_LONG}
        </p>
      ) : null}
      {empty !== null && empty.lines.placed.length === 0 ? <InlineNotice tone="info">{NOTHING_TO_READ}</InlineNotice> : null}
      {empty !== null && empty.lines.placed.length > 0 ? (
        <InlineNotice tone="info" actionLabel={OPEN_ANYWAY} onAction={() => openAnyway(empty)}>
          <span className={styles.line}>{NO_EXERCISES}</span>
          <span className={styles.line}>{foundLine(empty.sections.map((section) => section.name))}</span>
        </InlineNotice>
      ) : null}
      <div className={styles.howTo}>
        <p id={HOW_TO_ID}>{HOW_TO_INTRO}</p>
        <ol className={styles.steps} aria-labelledby={HOW_TO_ID}>
          {HOW_TO_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      <p className={styles.privacy}>{PRIVACY_LINE}</p>
      {atLimit ? (
        <p id={LIMIT_ID} className={styles.status}>
          {LIMIT_MESSAGE}
        </p>
      ) : null}
      <ActionBar>
        <Button disabled={blank || atLimit} aria-describedby={atLimit ? LIMIT_ID : undefined} onClick={readText}>
          {READ_BUTTON}
        </Button>
      </ActionBar>
    </Screen>
  );
}
