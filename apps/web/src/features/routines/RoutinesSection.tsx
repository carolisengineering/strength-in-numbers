import { useEffect } from "react";
import { Link } from "react-router";
import { ROUTINES_PER_USER_MAX } from "@sin/core";
import { Button } from "../../ui/Button";
import { InlineNotice } from "../../ui/InlineNotice";
import { EMPTY_ROUTINES, LIMIT_MESSAGE, LOAD_LIST_FAILED, REFRESH_LIST_FAILED } from "./messages";
import { NEW_ROUTINE_PATH, routinePath } from "./paths";
import { useRoutines } from "./queries";
import { reportRoutineUnexpected } from "./reportRoutine";
import { classifyRoutineError } from "./routineErrors";
import styles from "./RoutinesSection.module.css";
import { routineSummary } from "./targetFormat";

/** The Start screen's Routines section (Spec 10.0 AC15–AC17). Start empty workout stays usable throughout. */
export function RoutinesSection() {
  const routines = useRoutines();
  const list = routines.data;

  useEffect(() => {
    if (routines.error) reportRoutineUnexpected("load-routines", routines.error);
  }, [routines.error]);

  const requestId = routines.error ? classifyRoutineError(routines.error).requestId : null;
  const atLimit = list !== undefined && list.length >= ROUTINES_PER_USER_MAX;

  return (
    <section className={styles.section} aria-labelledby="routines-heading">
      <h2 id="routines-heading" className={styles.heading}>
        Routines
      </h2>
      {routines.isPending ? (
        <p role="status" className={styles.status}>
          Loading routines…
        </p>
      ) : null}
      {routines.isError ? (
        <InlineNotice
          tone={list === undefined ? "error" : "warning"}
          requestId={requestId}
          actionLabel="Retry"
          onAction={() => void routines.refetch()}
        >
          {list === undefined ? LOAD_LIST_FAILED : REFRESH_LIST_FAILED}
        </InlineNotice>
      ) : null}
      {list?.length === 0 ? <p className={styles.empty}>{EMPTY_ROUTINES}</p> : null}
      {list !== undefined && list.length > 0 ? (
        <ul className={styles.list} aria-label="Routines">
          {list.map((routine) => (
            <li key={routine.id}>
              <Link className={styles.row} to={routinePath(routine.id)}>
                <span className={styles.name}>{routine.name}</span>
                <span className={styles.summary}>{routineSummary(routine)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {routines.isPending ? null : atLimit ? (
        <div className={styles.limit}>
          <Button variant="secondary" disabled aria-describedby="routine-limit-text">
            New routine
          </Button>
          <p id="routine-limit-text" className={styles.status}>
            {LIMIT_MESSAGE}
          </p>
        </div>
      ) : (
        <Link className={styles.newLink} to={NEW_ROUTINE_PATH}>
          New routine
        </Link>
      )}
    </section>
  );
}
