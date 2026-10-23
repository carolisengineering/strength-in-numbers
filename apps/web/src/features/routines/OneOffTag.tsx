import { ONE_OFF_TAG } from "./messages";
import styles from "./OneOffTag.module.css";

/** Spec 10.5: the text tag a one-off routine carries on the list row and in the preview (text, not color alone). */
export function OneOffTag() {
  return <span className={styles.tag}>{ONE_OFF_TAG}</span>;
}
