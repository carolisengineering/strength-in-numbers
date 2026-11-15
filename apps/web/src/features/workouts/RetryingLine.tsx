import { SECTION_COPY } from "./sections/sectionCopy";
import styles from "./RetryingLine.module.css";

/**
 * Minor 564: the muted line a grouping's Try again shows in the banner's place while it re-reads and writes. The
 * region is mounted empty from first paint and stays mounted, so its words are announced when they appear.
 */
export function RetryingLine({ retrying }: { retrying: boolean }) {
  return (
    <p className={styles.line} aria-live="polite" data-retrying-line="">
      {retrying ? SECTION_COPY.tryingAgain : null}
    </p>
  );
}
