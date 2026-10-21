import { ROUTINES_PER_USER_MAX, type Routine } from "@sin/core";
import { useCallback, useMemo, useRef, useState } from "react";
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
  // The latest list at Save time: at the routine limit, say so and create no exercise (no leftovers).
  const routinesNow = useRef<readonly Routine[] | undefined>(routines.data);
  routinesNow.current = routines.data;
  // Built once per arrival: the draft is the editor's from here on.
  const [draft] = useState(() => draftFromImport(handoff.plan, (key) => handoff.exerciseIdOf.get(key)!));
  const pending = useMemo(
    () => new Map<string, PendingExerciseInfo>([...handoff.pending].map(([id, p]) => [id, { name: p.input.name, modality: p.input.modality }])),
    [handoff],
  );
  const prepareBody = useCallback(
    (body: RoutineWriteInput, sent: Draft): Promise<PreparedBody> =>
      prepareImportBody(
        { body, draft: sent, pending: handoff.pending, record: saveRecord, atLimit: (routinesNow.current?.length ?? 0) >= ROUTINES_PER_USER_MAX },
        { createCustom: store.createCustom, refresh: store.refresh, visibleRows: () => visibleRows(store.getState().rows) },
      ),
    [handoff, saveRecord, store],
  );
  return (
    <PendingExercisesContext.Provider value={pending}>
      <RoutineEditor key="import" routine={null} initial={{ draft, notices: <ImportNotices notices={handoff.plan.notices} />, prepareBody }} />
    </PendingExercisesContext.Provider>
  );
}
