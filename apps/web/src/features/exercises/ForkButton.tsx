import type { Exercise } from "@sin/core";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "../../ui/Button";
import { InlineNotice } from "../../ui/InlineNotice";
import { useCatalog } from "../catalog/useCatalog";
import { classifyExerciseError, exerciseErrorMessage } from "./exerciseErrors";
import { EXERCISES_COPY } from "./messages";
import { exercisePath } from "./paths";
import { useForkExercise } from "./useExerciseMutations";

/**
 * Make your own copy (Spec 18.2 AC43–AC45): a bodiless fork, then the copy's page by replace with the "copied"
 * notice. The fork's own store merge re-renders this page into a redirect before the request resolves, so the
 * notice navigation runs after `mutateAsync` (a per-call `onSuccess` is dropped once this unmounts).
 */
export function ForkButton({ row }: { row: Exercise }) {
  const fork = useForkExercise();
  const { refresh } = useCatalog();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // AC44 (03.4 D11): a second tap before React re-renders must not start a second copy.
  const busyRef = useRef(false);

  const onClick = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const copy = await fork.mutateAsync({ id: row.id });
      // Busy stays set: the page is going away.
      void navigate(exercisePath(copy.id), { replace: true, state: { notice: "copied" } });
    } catch (failure) {
      const kind = classifyExerciseError(failure);
      if (kind === "gone") await refresh(true);
      busyRef.current = false;
      setBusy(false);
      setError(exerciseErrorMessage(kind, "fork"));
    }
  };

  return (
    <>
      {error !== null ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <Button variant="secondary" busy={busy} onClick={() => void onClick()}>
        {EXERCISES_COPY.makeCopy}
      </Button>
    </>
  );
}
