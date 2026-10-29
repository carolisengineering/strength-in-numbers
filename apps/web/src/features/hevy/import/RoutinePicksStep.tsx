import { useId, type Ref } from "react";
import { ROUTINES_PER_USER_MAX } from "@sin/core";

import { Button } from "../../../ui/Button";
import { Spinner } from "../../../ui/Spinner";
import type { ImportState } from "./importSession";
import {
  CONTINUE,
  exerciseCount,
  NO_FOLDER,
  ROUTINE_EXISTS,
  ROUTINE_NO_ROOM,
  ROUTINE_SAME_NAME,
  routinesChosen,
  routinesRoom,
  ROUTINES_TITLE,
  TICK_ALL,
  TRY_AGAIN,
} from "./messages";
import { groupRoutines, pickAvailability, room, type PickAvailability, type PickContext, type RoutineGroup } from "./routinePicks";
import styles from "./ImportScreen.module.css";

const REASON: Readonly<Record<Exclude<PickAvailability, "ok">, string>> = {
  exists: ROUTINE_EXISTS,
  same_name_chosen: ROUTINE_SAME_NAME,
  no_room: ROUTINE_NO_ROOM,
};

// Plan copy.
const ROUTINES_LOAD_FAILED = "Couldn't load your routines. Check your connection and try again.";

/** Spec 20.1 AC7, §5.3: the routines to copy, by Hevy folder, within the cap room. Nothing is ticked by default. */
export function RoutinePicksStep({
  state,
  pickContext,
  routinesStatus,
  onRetryRoutines,
  onToggle,
  onTickAll,
  onContinue,
  headingRef,
}: {
  state: ImportState;
  pickContext: PickContext;
  routinesStatus: "pending" | "error" | "success";
  onRetryRoutines: () => void;
  onToggle: (id: string) => void;
  onTickAll: (group: RoutineGroup) => void;
  onContinue: () => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const groups = state.read === null ? [] : groupRoutines(state.read.folders, state.read.routines);
  const chosen = state.picks.picked.size;
  return (
    <section className={styles.step} aria-labelledby="hevy-import-step">
      <h2 className={styles.stepTitle} id="hevy-import-step" ref={headingRef} tabIndex={-1}>
        {ROUTINES_TITLE}
      </h2>
      {routinesStatus === "pending" ? <Spinner /> : null}
      {routinesStatus === "error" ? (
        <>
          <p className={styles.failure} role="alert">
            {ROUTINES_LOAD_FAILED}
          </p>
          <div className={styles.actions}>
            <Button onClick={onRetryRoutines}>{TRY_AGAIN}</Button>
          </div>
        </>
      ) : null}
      {routinesStatus === "success" ? (
        <>
          <p className={styles.text}>
            {routinesRoom(pickContext.routineCount, ROUTINES_PER_USER_MAX, room(pickContext.routineCount, state.picks))}
          </p>
          {groups.map((group) => (
            <Group key={group.folderId ?? "none"} group={group} pickContext={pickContext} onToggle={onToggle} onTickAll={onTickAll} />
          ))}
        </>
      ) : null}
      <p className={styles.status} role="status">
        {chosen > 0 ? routinesChosen(chosen) : ""}
      </p>
      <div className={styles.actions}>
        <Button onClick={onContinue} disabled={routinesStatus !== "success"}>
          {CONTINUE}
        </Button>
      </div>
    </section>
  );
}

function Group({
  group,
  pickContext,
  onToggle,
  onTickAll,
}: {
  group: RoutineGroup;
  pickContext: PickContext;
  onToggle: (id: string) => void;
  onTickAll: (group: RoutineGroup) => void;
}) {
  const title = group.title ?? NO_FOLDER;
  const headingId = useId();
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.actions}>
        <h3 className={styles.cardTitle} id={headingId}>
          {title}
        </h3>
        <Button variant="secondary" onClick={() => onTickAll(group)} aria-label={`${TICK_ALL}: ${title}`}>
          {TICK_ALL}
        </Button>
      </div>
      <ul className={styles.picks}>
        {group.routines.map((r) => (
          <RoutineRow key={r.id} id={r.id} title={r.title} count={r.exercises.length} availability={pickAvailability(r, pickContext)} picked={pickContext.picks.picked.has(r.id)} onToggle={onToggle} />
        ))}
      </ul>
    </section>
  );
}

function RoutineRow({
  id,
  title,
  count,
  availability,
  picked,
  onToggle,
}: {
  id: string;
  title: string;
  count: number;
  availability: PickAvailability;
  picked: boolean;
  onToggle: (id: string) => void;
}) {
  const inputId = useId();
  const noteId = useId();
  const blocked = availability !== "ok" && !picked;
  return (
    <li className={styles.pick}>
      <input id={inputId} type="checkbox" checked={picked} disabled={blocked} aria-describedby={noteId} onChange={() => onToggle(id)} />
      <label htmlFor={inputId}>{title}</label>
      <span className={styles.muted} id={noteId}>
        {blocked ? REASON[availability as Exclude<PickAvailability, "ok">] : exerciseCount(count)}
      </span>
    </li>
  );
}
