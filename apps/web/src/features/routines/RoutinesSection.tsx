import { useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router";
import { ROUTINES_PER_USER_MAX } from "@sin/core";
import { Button } from "../../ui/Button";
import { InlineNotice } from "../../ui/InlineNotice";
import { usePane } from "../../ui/paneContext";
import selection from "../../ui/selectedRow.module.css";
import { EMPTY_ROUTINES, LIMIT_MESSAGE, LOAD_LIST_FAILED, REFRESH_LIST_FAILED } from "./messages";
import { OneOffTag } from "./OneOffTag";
import { isOneOff, oneOffMeta } from "./oneOff";
import { EDITOR_FROM_BACK, IMPORT_PATH, NEW_ROUTINE_PATH, routinePath } from "./paths";
import { useRoutines } from "./queries";
import { reportRoutineUnexpected } from "./reportRoutine";
import { classifyRoutineError } from "./routineErrors";
import styles from "./RoutinesSection.module.css";
import { routineSummary } from "./targetFormat";

/** The Start screen's Routines section (Spec 10.0 AC15–AC17). Start empty workout stays usable throughout. */
export function RoutinesSection() {
  const routines = useRoutines();
  const list = routines.data;
  // Spec 17.12 AC29: the routine open in the detail pane beside the list. Choosing it again does nothing: a Link to the
  // current path would still navigate (a replace with no state), dropping the editor's "came from the preview" flag,
  // so its Cancel and Save would replace instead of going back (final review M1).
  const pane = usePane();
  const { pathname } = useLocation();
  // The row title marker only in the list pane, so the phone's rows keep today's markup (Spec 10.5 AC2's snapshot).
  const rowTitle = pane.slot === "list" ? { "data-row-title": "" } : {};
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Spec 10.5 AC4: read once per list data change, never on a timer
  const now = useMemo(() => Date.now(), [list]);

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
          {list.map((routine) => {
            const selected = routine.id === pane.selectedId;
            return (
              <li key={routine.id}>
                <Link
                  className={selected ? `${styles.row} ${selection.selected}` : styles.row}
                  to={selected ? pathname : routinePath(routine.id)}
                  aria-current={selected ? "page" : undefined}
                  onClick={selected ? (event) => event.preventDefault() : undefined}
                >
                  {isOneOff(routine) ? (
                    // Spec 10.5 AC2: the tag is text on the name line, inside the link (not color alone).
                    <>
                      <span className={styles.nameLine} {...rowTitle}>
                        <span className={styles.name}>{routine.name}</span> <OneOffTag />
                      </span>
                      <span className={styles.summary}>{oneOffMeta(routine, now)}</span>
                    </>
                  ) : (
                    <>
                      <span className={styles.name} {...rowTitle}>
                        {routine.name}
                      </span>
                      <span className={styles.summary}>{routineSummary(routine)}</span>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      {routines.isPending ? null : atLimit ? (
        <div className={styles.limit}>
          <div className={styles.newRow}>
            <Button variant="secondary" disabled aria-describedby="routine-limit-text">
              New routine
            </Button>
            <Button variant="secondary" disabled aria-describedby="routine-limit-text">
              New from text
            </Button>
          </div>
          <p id="routine-limit-text" className={styles.status}>
            {LIMIT_MESSAGE}
          </p>
        </div>
      ) : (
        <div className={styles.newRow}>
          <Link className={styles.newLink} to={NEW_ROUTINE_PATH} state={EDITOR_FROM_BACK}>
            New routine
          </Link>
          {/* Spec 10.4 AC19: paste a gym app's workout text and turn it into a routine. */}
          <Link className={styles.newLink} to={IMPORT_PATH} state={EDITOR_FROM_BACK}>
            New from text
          </Link>
        </div>
      )}
    </section>
  );
}
