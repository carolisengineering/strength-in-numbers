import { useMemo, useState } from "react";

export interface ClearOnEdit<K extends string> {
  /** The field's message, or undefined once the lifter has edited that field since the last Done or Save. */
  of(field: K): string | undefined;
  /** Every message still shown, as a plain record (for a component that takes an errors object). */
  readonly visible: Partial<Record<K, string>>;
  /** Call from the field's onChange. It only ever hides a message; it never adds one. */
  edit(...fields: K[]): void;
}

/**
 * One rule for every sheet: a field's error shows from the Done or Save that found it until the lifter edits that
 * field; the next Done or Save checks every field again (minors 313, 326, 521). The edited set belongs to one errors
 * object: a new object (the next Done or Save, or a server 422) starts with nothing hidden. So never pass a fresh
 * object on every render (`errors.timer ?? {}`): keep the stored object, or a module-level constant for "none".
 */
export function useClearOnEdit<K extends string>(errors: Partial<Record<K, string | null | undefined>>): ClearOnEdit<K> {
  const [state, setState] = useState<{ source: object; edited: ReadonlySet<K> }>(() => ({ source: errors, edited: new Set() }));
  const edited = state.source === errors ? state.edited : NONE_EDITED;
  return useMemo(() => {
    const of = (field: K): string | undefined => {
      const message = errors[field];
      return message && !edited.has(field) ? message : undefined;
    };
    const visible: Partial<Record<K, string>> = {};
    for (const field of Object.keys(errors) as K[]) {
      const message = of(field);
      if (message !== undefined) visible[field] = message;
    }
    return {
      of,
      visible,
      edit: (...fields: K[]) => {
        if (!fields.some((field) => of(field) !== undefined)) return;
        setState((prev) => ({ source: errors, edited: new Set([...(prev.source === errors ? prev.edited : []), ...fields]) }));
      },
    };
  }, [errors, edited]);
}

const NONE_EDITED: ReadonlySet<never> = new Set();
