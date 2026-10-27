import type { Exercise } from "@sin/core";
import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { Button } from "../../ui/Button";
import { InlineNotice } from "../../ui/InlineNotice";
import { useCatalog } from "../catalog/useCatalog";
import { classifyExerciseError, exerciseErrorMessage } from "./exerciseErrors";
import { EXERCISES_COPY } from "./messages";
import { exercisePath, FROM_RECORDS, isFromRecords } from "./paths";
import { useForkExercise } from "./useExerciseMutations";

/**
 * Make your own copy (Spec 18.2 AC43–AC45): a bodiless fork, then the copy's page by replace with the "copied"
 * notice. The fork's own store merge re-renders this page into a redirect before the request resolves, so the
 * notice navigation runs after `mutateAsync` (a per-call `onSuccess` is dropped once this unmounts).
 * `onStatus` is the page's status line, for a failure the button may not live to show (deferred minor 126).
 */
export function ForkButton({ row, onStatus }: { row: Exercise; onStatus: (text: string) => void }) {
  const fork = useForkExercise();
  const { refresh } = useCatalog();
  const navigate = useNavigate();
  const location = useLocation();
  const fromRecords = isFromRecords(location.state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // AC44 (03.4 D11): a second tap before React re-renders must not start a second copy.
  const busyRef = useRef(false);

  const onClick = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    onStatus("");
    try {
      const copy = await fork.mutateAsync({ id: row.id });
      // Busy stays set: the page is going away.
      // A copy started from a Records row keeps "Back to Records" (deferred minor 123).
      void navigate(exercisePath(copy.id), { replace: true, state: { ...(fromRecords ? FROM_RECORDS : {}), notice: "copied" } });
    } catch (failure) {
      const kind = classifyExerciseError(failure);
      if (kind === "gone") {
        // The refresh can retire the built-in, turning this page into the deleted variant without this button.
        onStatus(exerciseErrorMessage(kind, "fork") ?? "");
        await refresh(true);
      }
      busyRef.current = false;
      setBusy(false);
      if (kind !== "gone") setError(exerciseErrorMessage(kind, "fork"));
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
