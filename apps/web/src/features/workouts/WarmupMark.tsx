import type { Modality, SetEntry, SetType } from "@sin/core";

import { VisuallyHidden } from "../../ui/VisuallyHidden";
import { formatSetParts } from "./format";
import styles from "./WarmupMark.module.css";

/**
 * The visible warm-up cue (Spec 17.0 AC8): a fixed-width slot on every set row, holding "W" on a warm-up set
 * and nothing otherwise, so warm-up and working weights share one column. Decorative (`aria-hidden`): the row's
 * text keeps "(Warm-up)" for assistive technology only (Spec 17.1 AC39b). Shared by the active card and the finished summary.
 */
export function WarmupMark({ setType }: { setType: SetType }) {
  return (
    <span className={styles.mark} aria-hidden="true">
      {setType === "warmup" ? "W" : ""}
    </span>
  );
}

/** A logged set's text (Spec 17.1 AC39b): a warm-up's "(Warm-up)" is spoken, not shown; the W mark is the visible cue. */
export function SetText({ set, modality }: { set: SetEntry; modality: Modality }) {
  const { core, typeSuffix } = formatSetParts(set, modality);
  return (
    <span>
      {core}
      {/* The space stays outside the hidden span: name computation trims a hidden node's leading space ("8(Warm-up)"). */}
      {set.setType === "warmup" ? (
        <>
          {" "}
          <VisuallyHidden>{typeSuffix.trimStart()}</VisuallyHidden>
        </>
      ) : (
        typeSuffix
      )}
    </span>
  );
}
