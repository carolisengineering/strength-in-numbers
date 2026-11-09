import { useEffect, useRef, useState, type RefObject } from "react";

export interface DeleteConfirm {
  confirming: boolean;
  ask(): void;
  keep(): void;
  /** The delete failed: back to the form, where its alert shows. */
  failed(): void;
  /** The form's Delete set button, where focus returns when the confirm closes. */
  askRef: RefObject<HTMLButtonElement | null>;
}

/** Spec 17.5 AC18: the set sheets' one `confirming` state. The confirm unmounts with focus inside it, so focus goes back. */
export function useDeleteConfirm(): DeleteConfirm {
  const [confirming, setConfirming] = useState(false);
  const askRef = useRef<HTMLButtonElement | null>(null);
  const returning = useRef(false);
  useEffect(() => {
    if (confirming || !returning.current) return;
    returning.current = false;
    askRef.current?.focus();
  }, [confirming]);
  const close = () => {
    returning.current = true;
    setConfirming(false);
  };
  return { confirming, ask: () => setConfirming(true), keep: close, failed: close, askRef };
}
