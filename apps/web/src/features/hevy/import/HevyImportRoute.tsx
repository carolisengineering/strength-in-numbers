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
 * Without a stored key it shows the key card instead of the flow.
 */
export function HevyImportRoute() {
  const { hasKey } = useHevyKey();
  if (hasKey) return <ImportScreen />;
  return (
    <Screen title={IMPORT_TITLE} lead={<BackLink to={HEVY_PATH} label={BACK_TO_HEVY} />}>
      <div className={styles.body}>
        <p className={styles.text}>{ADD_KEY_FIRST}</p>
        <HevyKeyCard />
      </div>
    </Screen>
  );
}
