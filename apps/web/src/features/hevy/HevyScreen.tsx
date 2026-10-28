import { BackLink } from "../../ui/BackLink";
import { Screen } from "../../ui/Screen";
import { HevyKeyCard } from "./HevyKeyCard";
import styles from "./HevyScreen.module.css";

/** Spec 20.0 §5.1: the owner's Hevy screen. Phase A holds the key card; Phase B adds the pairings. */
export function HevyScreen() {
  return (
    <Screen title="Hevy" lead={<BackLink to="/app/profile" label="Back to Profile" />}>
      <div className={styles.body}>
        <HevyKeyCard />
      </div>
    </Screen>
  );
}
