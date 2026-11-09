import type { ComponentPropsWithoutRef } from "react";

import { ChevronDownIcon } from "./icons";
import styles from "./Select.module.css";

export type SelectProps = ComponentPropsWithoutRef<"select"> & {
  /** Shrink to the content (the picker's filters) instead of filling the row. */
  inline?: boolean;
};

/**
 * A long or data-driven list (Spec 17.7 AC4, §6.1, D2): a real `<select>`, so the platform's menu, keyboard and
 * screen-reader behavior stay, with the field's height, radius and border and a drawn chevron. Every prop goes to the
 * select, including the `id`, `aria-describedby` and `aria-invalid` a `Field` hands over. The root is a `span`
 * because the Hevy sheet nests it in a `<label>`.
 */
export function Select({ inline = false, className, children, ...rest }: SelectProps) {
  return (
    <span className={inline ? `${styles.wrap} ${styles.inline}` : styles.wrap}>
      <select className={className ? `${styles.select} ${className}` : styles.select} {...rest}>
        {children}
      </select>
      <ChevronDownIcon className={styles.chevron} />
    </span>
  );
}
