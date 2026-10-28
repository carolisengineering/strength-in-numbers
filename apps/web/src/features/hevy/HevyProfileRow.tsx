import { Link } from "react-router";

import { HEVY_PATH } from "./paths";
import { useHevyEnabled } from "./useHevyStatus";
import styles from "./HevyProfileRow.module.css";

/** Spec 20.0 AC1: Profile's Hevy row, drawn only once the status says this account has Hevy. */
export function HevyProfileRow() {
  if (useHevyEnabled() !== "on") return null;
  return (
    <Link className={styles.row} to={HEVY_PATH}>
      <span>Hevy</span>
      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    </Link>
  );
}
