import { IMPORT_TEXT_MAX, ROUTINES_PER_USER_MAX, readWorkoutText } from "@sin/core";
import { useState } from "react";
import { useNavigate } from "react-router";

import { ActionBar } from "../../../ui/ActionBar";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Screen } from "../../../ui/Screen";
import { LIMIT_MESSAGE } from "../messages";
import { IMPORT_NAMES_PATH } from "../paths";
import { useRoutines } from "../queries";
import { BackToWorkouts } from "../RoutinePreview";
import styles from "./ImportPaste.module.css";
import { useImportSession } from "./ImportSession";
import { HOW_TO_INTRO, HOW_TO_STEPS, PASTE_TITLE, PRIVACY_LINE, READ_BUTTON, TEXT_LABEL, TOO_LONG } from "./messages";

const LIMIT_ID = "import-limit-text";
const HOW_TO_ID = "import-how-to";

/** Spec 10.4 §5.2, AC19, AC21–AC22: paste the Live Text, then Read workout. Nothing is saved here. */
export function ImportPaste() {
  const session = useImportSession();
  const navigate = useNavigate();
  const routines = useRoutines();
  const [tooLong, setTooLong] = useState(false);
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
    if (result.items.length > 0) navigate(IMPORT_NAMES_PATH);
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
            }}
          />
        )}
      </Field>
      {tooLong ? (
        <p className={styles.alert} role="alert">
          {TOO_LONG}
        </p>
      ) : null}
      <div className={styles.howTo}>
        <p id={HOW_TO_ID}>{HOW_TO_INTRO}</p>
        <ol className={styles.steps} aria-label={HOW_TO_INTRO}>
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
