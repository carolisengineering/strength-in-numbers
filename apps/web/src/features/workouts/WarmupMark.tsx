import type { SetType } from "@sin/core";

import styles from "./WarmupMark.module.css";

/**
 * The visible warm-up cue (Spec 17.0 AC8): a fixed-width slot on every set row, holding "W" on a warm-up set
 * and nothing otherwise, so warm-up and working weights share one column. Decorative (`aria-hidden`): the row's
 * own text keeps "(Warm-up)" as the accessible cue. Shared by the active card and the finished summary.
 */
export function WarmupMark({ setType }: { setType: SetType }) {
  return (
    <span className={styles.mark} aria-hidden="true">
      {setType === "warmup" ? "W" : ""}
    </span>
  );
}
