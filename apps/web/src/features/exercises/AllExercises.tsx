import type { Exercise } from "@sin/core";
import { memo, useContext, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useOutletContext } from "react-router";

import { Button } from "../../ui/Button";
import { InlineNotice } from "../../ui/InlineNotice";
import { Sheet } from "../../ui/Sheet";
import { Spinner } from "../../ui/Spinner";
import { CreateExerciseForm } from "../catalog/CreateExerciseForm";
import { useEquipment, useMuscleGroups } from "../catalog/referenceData";
import { useCatalog } from "../catalog/useCatalog";
import { searchByName } from "../catalog/visibility";
import { ProgressClockContext } from "../progress/queries";
import { reportUnexpected } from "../workouts/reportUnexpected";
import styles from "./AllExercises.module.css";
import { buildExerciseRows, metaLine } from "./exerciseRows";
import type { ExercisesOutletContext } from "./ExercisesLayout";
import { EXERCISES_COPY } from "./messages";
import { exercisePath } from "./paths";
import { useExerciseUsage } from "./usage";

const NO_USAGE: ReadonlyMap<string, string> = new Map();

/** One row: a single link, the name first so the accessible name starts with it (AC11). Memoized for AC18. */
const ExerciseListRow = memo(function ExerciseListRow({ id, name, meta }: { id: string; name: string; meta: string }) {
  return (
    <li>
      <Link className={styles.row} to={exercisePath(id)}>
        <span className={styles.name}>{name}</span>
        <span className={styles.meta}>{meta}</span>
      </Link>
    </li>
  );
});

/**
 * Every exercise the lifter can pick (Spec 18.2 AC11–AC18): logged ones first by last-logged date, then
 * A–Z; a search that only narrows; **+ New exercise**. The list waits for the usage read so its order
 * never jumps under a finger; once usage is known (or has failed) it renders at once.
 */
export function AllExercises() {
  const location = useLocation();
  const navigate = useNavigate();
  const { titleRef } = useOutletContext<ExercisesOutletContext>();
  const [notice, setNotice] = useState("");

  // Spec 18.2 AC50: a delete lands here with `{ notice: "deleted", name }` (display only); announce it once, clear
  // it from the history entry so a reload doesn't repeat it, and put focus on the title.
  const routerState = location.state as { notice?: unknown; name?: unknown } | null;
  useEffect(() => {
    if (routerState?.notice !== "deleted" || typeof routerState.name !== "string") return;
    setNotice(EXERCISES_COPY.deletedNotice(routerState.name));
    void navigate(location.pathname, { replace: true, state: null });
    titleRef.current?.focus();
  }, [routerState, location.pathname, navigate, titleRef]);

  return (
    <>
      {/* Mounted from first paint, so the notice is announced when it arrives. */}
      <p className={styles.notice} role="status">
        {notice}
      </p>
      {/* The first search keystroke clears it, so a stale line doesn't sit above the results (deferred minor 129). */}
      <ExerciseList onSearch={() => setNotice("")} />
    </>
  );
}

function ExerciseList({ onSearch }: { onSearch: () => void }) {
  const { visible, state, refresh } = useCatalog();
  const usage = useExerciseUsage();
  const today = useContext(ProgressClockContext)();
  const muscles = useMuscleGroups();
  const equipment = useEquipment();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (usage.error) reportUnexpected("load-exercise-usage", usage.error);
  }, [usage.error]);

  const rows = useMemo(() => buildExerciseRows(visible, usage.data ?? NO_USAGE), [visible, usage.data]);
  const shown = useMemo(() => {
    const kept = new Set<Exercise>(searchByName(rows.map((r) => r.row), query));
    return rows.filter((r) => kept.has(r.row));
  }, [rows, query]);

  if (visible.length === 0 && state.status === "error") {
    return (
      <InlineNotice tone="error" actionLabel={EXERCISES_COPY.retry} onAction={() => void refresh(true)}>
        {EXERCISES_COPY.loadExercisesFailed}
      </InlineNotice>
    );
  }
  if ((visible.length === 0 && (state.lastRefreshAt === null || state.status === "loading")) || usage.isPending) {
    return <Spinner label={EXERCISES_COPY.loadingExercises} />;
  }

  const usageKnown = usage.data !== undefined;
  const searching = query.trim() !== "";
  const openCreate = () => setCreating(true);

  return (
    <div className={styles.view}>
      {usage.isError ? (
        <InlineNotice tone="error" actionLabel={EXERCISES_COPY.tryAgain} onAction={() => void usage.refetch()}>
          {EXERCISES_COPY.usageFailed}
        </InlineNotice>
      ) : null}
      <div className={styles.searchRow}>
        <input
          type="search"
          className={styles.search}
          aria-label={EXERCISES_COPY.searchLabel}
          placeholder={`${EXERCISES_COPY.searchLabel}…`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            onSearch();
          }}
        />
        <Button variant="secondary" onClick={openCreate}>
          <span aria-hidden="true">+</span> {EXERCISES_COPY.newExercise}
        </Button>
      </div>
      {/* Mounted and empty while there is no query, so VoiceOver announces the first count (deferred minor 122). */}
      <p role="status" className={styles.count} data-testid="exercise-count">
        {searching ? EXERCISES_COPY.count(shown.length) : ""}
      </p>
      {visible.length === 0 ? (
        <p>{EXERCISES_COPY.noExercises}</p>
      ) : shown.length === 0 ? (
        <div className={styles.empty}>
          <p>{EXERCISES_COPY.noMatch(query.trim())}</p>
          <Button variant="secondary" onClick={openCreate}>
            {EXERCISES_COPY.newExerciseNamed(query.trim())}
          </Button>
        </div>
      ) : (
        <ul className={styles.list} aria-label={EXERCISES_COPY.listLabel}>
          {shown.map((item) => (
            <ExerciseListRow key={item.row.id} id={item.row.id} name={item.row.name} meta={metaLine(item, today, usageKnown)} />
          ))}
        </ul>
      )}
      <Sheet open={creating} title={EXERCISES_COPY.newExerciseSheet} onClose={() => setCreating(false)}>
        {creating ? (
          <CreateExerciseForm
            initialName={query}
            muscleGroups={muscles.data}
            equipment={equipment.data}
            onCreated={(created) => {
              setCreating(false);
              void navigate(exercisePath(created.id));
            }}
            onCancel={() => setCreating(false)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}
