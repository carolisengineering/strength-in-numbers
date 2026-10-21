import { useMemo, useState } from "react";
import { Navigate } from "react-router";

import { PendingExercisesContext, type PendingExerciseInfo } from "../exerciseLookup";
import { IMPORT_PATH } from "../paths";
import { RoutineEditor } from "../RoutineEditor";
import type { ImportHandoff } from "./handoff";
import { draftFromImport } from "./importDraft";
import { ImportNotices } from "./ImportNotices";
import { useImportSession } from "./ImportSession";

/** Spec 10.4 AC30: the `edit` route — the hand-off as an editor draft. No hand-off (a reload) → the paste screen. */
export function ImportEditRoute() {
  const { handoff } = useImportSession();
  if (handoff === null) return <Navigate to={IMPORT_PATH} replace />;
  return <ImportEditor handoff={handoff} />;
}

function ImportEditor({ handoff }: { handoff: ImportHandoff }) {
  // Built once per arrival: the draft is the editor's from here on.
  const [draft] = useState(() => draftFromImport(handoff.plan, (key) => handoff.exerciseIdOf.get(key)!));
  const pending = useMemo(
    () => new Map<string, PendingExerciseInfo>([...handoff.pending].map(([id, p]) => [id, { name: p.input.name, modality: p.input.modality }])),
    [handoff],
  );
  return (
    <PendingExercisesContext.Provider value={pending}>
      <RoutineEditor key="import" routine={null} initial={{ draft, notices: <ImportNotices notices={handoff.plan.notices} /> }} />
    </PendingExercisesContext.Provider>
  );
}
