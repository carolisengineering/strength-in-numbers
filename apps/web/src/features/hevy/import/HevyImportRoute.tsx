import { useCallback, useState } from "react";

import { BackLink } from "../../../ui/BackLink";
import { Screen } from "../../../ui/Screen";
import { HevyKeyCard } from "../HevyKeyCard";
import { HEVY_PATH } from "../paths";
import { useHevyKey } from "../useHevyKey";
import { ImportScreen } from "./ImportScreen";
import { ADD_KEY_FIRST, BACK_TO_HEVY, IMPORT_TITLE } from "./messages";
import styles from "./ImportScreen.module.css";

/**
 * Spec 20.1 AC1: rendered inside 20.0's `HevyRoute` (the spinner, the unreachable screen and `NotFound` are its).
 * Without a stored key it shows the key card instead of the flow — until the run starts (minor 251): the run doesn't
 * need the key (AC16), so a key removed in another tab from then on must not unmount it.
 */
export function HevyImportRoute() {
  const { hasKey } = useHevyKey();
  const [running, setRunning] = useState(false);
  const pin = useCallback(() => setRunning(true), []);
  if (hasKey || running) return <ImportScreen onRunStarted={pin} />;
  return (
    <Screen title={IMPORT_TITLE} lead={<BackLink to={HEVY_PATH} label={BACK_TO_HEVY} />}>
      <div className={styles.body}>
        <p className={styles.text}>{ADD_KEY_FIRST}</p>
        <HevyKeyCard />
      </div>
    </Screen>
  );
}
