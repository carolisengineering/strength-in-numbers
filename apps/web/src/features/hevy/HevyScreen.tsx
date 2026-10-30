import { BackLink } from "../../ui/BackLink";
import { Screen } from "../../ui/Screen";
import { AutoPushSetting } from "./AutoPushSetting";
import { HevyKeyCard } from "./HevyKeyCard";
import { ImportCard } from "./import/ImportCard";
import { StaleRecordsBanner } from "./import/StaleRecordsBanner";
import { MappingCard } from "./mapping/MappingCard";
import styles from "./HevyScreen.module.css";

/**
 * Spec 20.0 §5.1: the owner's Hevy screen. Phase A holds the key card; Phase B adds the pairings; Spec 20.1 adds the
 * import card and, while the records are stale, the finish banner (AC22); Spec 20.2 the auto-push switch (AC23).
 */
export function HevyScreen() {
  return (
    <Screen title="Hevy" lead={<BackLink to="/app/profile" label="Back to Profile" />}>
      <div className={styles.body}>
        <StaleRecordsBanner />
        <HevyKeyCard />
        <AutoPushSetting />
        <MappingCard />
        <ImportCard />
      </div>
    </Screen>
  );
}
