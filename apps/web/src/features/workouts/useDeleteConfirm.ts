import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface DeleteConfirm {
  confirming: boolean;
  ask(): void;
  keep(): void;
  /** The delete failed: back to the form, where its alert shows. */
  failed(): void;
  /** The form's Delete set button, where focus returns when the confirm closes. */
  askRef: RefObject<HTMLButtonElement | null>;
  /** The confirm's Keep set button, which takes focus when the confirm opens, so a stray Enter keeps the set. */
  keepRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Spec 17.5 AC18: the set sheets' one `confirming` state. Opening the confirm focuses Keep set; closing it sends focus
 * back to Delete set, since the button that had focus unmounts. Spec 17.10: the confirm's buttons sit in the sheet's row.
 */
export function useDeleteConfirm(): DeleteConfirm {
  const [confirming, setConfirming] = useState(false);
  const askRef = useRef<HTMLButtonElement | null>(null);
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const returning = useRef(false);
  useLayoutEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (confirming || !returning.current) return;
    returning.current = false;
    askRef.current?.focus();
  }, [confirming]);
  const close = () => {
    returning.current = true;
    setConfirming(false);
  };
  return { confirming, ask: () => setConfirming(true), keep: close, failed: close, askRef, keepRef };
}
