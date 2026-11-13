import type { InputHTMLAttributes, ReactNode, Ref } from "react";

import styles from "./RadioChip.module.css";

export type RadioChipProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  ref?: Ref<HTMLInputElement>;
  /** A full-width chip, for a list of long names (a template, an exercise). */
  block?: boolean;
  children: ReactNode;
};

/**
 * Spec 17.13 AC16: one of the app's two radio looks. A chip is a labeled native radio for a list of choices that
 * don't fit a Segmented strip (more than four, or long names); every prop but `block` and `children` goes on the
 * input. The checked chip is outlined in the selection color, a disabled one is muted.
 */
export function RadioChip({ block = false, children, ref, ...input }: RadioChipProps) {
  return (
    <label className={block ? `${styles.chip} ${styles.block}` : styles.chip}>
      <input ref={ref} type="radio" {...input} />
      {children}
    </label>
  );
}
