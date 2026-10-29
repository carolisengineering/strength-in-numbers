import { Link } from "react-router";

import { useHevyKey } from "../useHevyKey";
import { ADD_KEY_FIRST, IMPORT_CARD_BODY, IMPORT_CARD_TITLE } from "./messages";
import { HEVY_IMPORT_PATH } from "./paths";
import styles from "./ImportScreen.module.css";

/** Spec 20.1 AC1: the Hevy screen's import card (the screen itself is drawn only with status `200`). */
export function ImportCard() {
  const { hasKey } = useHevyKey();
  return (
    <section className={styles.card} aria-labelledby="hevy-import-title">
      <h2 className={styles.cardTitle} id="hevy-import-title">
        {IMPORT_CARD_TITLE}
      </h2>
      <p className={styles.muted}>{IMPORT_CARD_BODY}</p>
      {hasKey ? (
        <Link className={styles.link} to={HEVY_IMPORT_PATH}>
          {IMPORT_CARD_TITLE}
        </Link>
      ) : (
        <p className={styles.text}>{ADD_KEY_FIRST}</p>
      )}
    </section>
  );
}
