import { ROUTINES_PER_USER_MAX } from "@sin/core";
import { useCallback, useMemo, useState } from "react";
import { Navigate } from "react-router";

import { useCatalogStore } from "../../catalog/CatalogProvider";
import { visibleRows } from "../../catalog/visibility";

import { PendingExercisesContext, type PendingExerciseInfo } from "../exerciseLookup";
import { IMPORT_PATH } from "../paths";
import { useRoutines } from "../queries";
import { RoutineEditor, type PreparedBody } from "../RoutineEditor";
import type { Draft } from "../routineDraft";
import type { RoutineWriteInput } from "../validateDraft";
import type { ImportHandoff } from "./handoff";
import { draftFromImport } from "./importDraft";
import { ImportNotices } from "./ImportNotices";
import { useImportSession } from "./ImportSession";
import { prepareImportBody } from "./saveImport";

/** Spec 10.4 AC30: the `edit` route — the hand-off as an editor draft. No hand-off (a reload) → the paste screen. */
export function ImportEditRoute() {
  const { handoff } = useImportSession();
  if (handoff === null) return <Navigate to={IMPORT_PATH} replace />;
  return <ImportEditor handoff={handoff} />;
}

function ImportEditor({ handoff }: { handoff: ImportHandoff }) {
  const { saveRecord } = useImportSession();
  const store = useCatalogStore();
  const routines = useRoutines();
  // At the routine limit, say so and create no exercise (no leftovers): Save reads the list afresh, because
  // another device may have added the 50th routine since this tab last fetched it.
  const { refetch: refetchRoutines } = routines;
  // Built once per arrival: the draft is the editor's from here on.
  const [draft] = useState(() => draftFromImport(handoff.plan, (key) => handoff.exerciseIdOf.get(key)!));
  const pending = useMemo(
    () => new Map<string, PendingExerciseInfo>([...handoff.pending].map(([id, p]) => [id, { name: p.input.name, modality: p.input.modality }])),
    [handoff],
  );
  const prepareBody = useCallback(
    async (body: RoutineWriteInput, sent: Draft, signal: AbortSignal): Promise<PreparedBody> => {
      // A failed read keeps the cached list (TanStack keeps `data`); the creates then fail offline anyway.
      const { data: list } = await refetchRoutines();
      return prepareImportBody(
        { body, draft: sent, pending: handoff.pending, record: saveRecord, atLimit: (list?.length ?? 0) >= ROUTINES_PER_USER_MAX, signal },
        { createCustom: store.createCustom, refresh: store.refresh, visibleRows: () => visibleRows(store.getState().rows) },
      );
    },
    [handoff, saveRecord, store, refetchRoutines],
  );
  return (
    <PendingExercisesContext.Provider value={pending}>
      <RoutineEditor key="import" routine={null} initial={{ draft, notices: <ImportNotices notices={handoff.plan.notices} />, prepareBody, oneOff: true }} />
    </PendingExercisesContext.Provider>
  );
}
