import type { Exercise } from "@sin/core";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { track } from "../../observability/track";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { Spinner } from "../../ui/Spinner";
import { CreateExerciseForm } from "./CreateExerciseForm";
import styles from "./ExercisePicker.module.css";
import { MODALITY_LABELS } from "./labels";
import { useEquipment, useMuscleGroups } from "./referenceData";
import { useCatalog } from "./useCatalog";
import { filterByAttributes, searchByName } from "./visibility";

type PickSource = "recent" | "list" | "search";

export interface ExercisePickerProps {
  open: boolean;
  /** Receives the full exercise. The picker does not close itself. */
  onPick: (exercise: Exercise) => void;
  onClose: () => void;
}

/**
 * The exercise picker sheet (Spec 06.0 §5, AC25–AC29): recents, an A–Z list,
 * search, muscle/equipment filters, and a create-custom row. Recents come
 * first and the search field is deliberately not focused, so a returning
 * lifter sees their usual exercises before a keyboard covers them.
 *
 * Not mounted anywhere by Spec 06.0 — Spec 06.1 renders it from "Add
 * exercise", inside a `<CatalogProvider>`.
 */
export function ExercisePicker({ open, onPick, onClose }: ExercisePickerProps) {
  const { state, visible, recents, refresh, recordPick } = useCatalog();
  const muscles = useMuscleGroups();
  const equipment = useEquipment();
  const [view, setView] = useState<"list" | "create">("list");
  const [search, setSearch] = useState("");
  const [muscleId, setMuscleId] = useState<string | null>(null);
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const openedAt = useRef(0);
  const recentHeadingId = useId();
  const allHeadingId = useId();

  useEffect(() => {
    if (open) {
      openedAt.current = Date.now();
      void refresh();
      return;
    }
    // Closed: the next open starts clean.
    setView("list");
    setSearch("");
    setMuscleId(null);
    setEquipmentId(null);
  }, [open, refresh]);

  const query = search.trim();
  const narrowing = query !== "" || muscleId !== null || equipmentId !== null;

  const listed = useMemo(
    () => filterByAttributes(searchByName(visible, search), { muscleId, equipmentId }),
    [visible, search, muscleId, equipmentId],
  );

  const equipmentNames = useMemo(
    () => new Map((equipment.data ?? []).map((item) => [item.id, item.name])),
    [equipment.data],
  );

  const pick = (exercise: Exercise, source: PickSource) => {
    recordPick(exercise.id);
    track("exercise_picked", { source, msSinceOpen: Date.now() - openedAt.current });
    onPick(exercise);
  };

  const row = (exercise: Exercise, source: PickSource) => {
    const equipmentName =
      exercise.equipmentId === null ? undefined : equipmentNames.get(exercise.equipmentId);
    const meta = [MODALITY_LABELS[exercise.modality], equipmentName]
      .filter((part): part is string => part !== undefined)
      .join(" · ");
    return (
      <li key={exercise.id}>
        <button type="button" className={styles.row} onClick={() => pick(exercise, source)}>
          <span className={styles.rowMain}>
            <span className={styles.rowName}>{exercise.name}</span>
            <span className={styles.rowMeta}>{meta}</span>
          </span>
          {exercise.ownerUserId !== null ? <span className={styles.tag}>Custom</span> : null}
        </button>
      </li>
    );
  };

  const renderList = () => {
    const empty = state.rows.length === 0;
    if (empty && state.status === "error") {
      return (
        <div className={styles.notice} role="alert">
          <p>Couldn't load exercises</p>
          <Button onClick={() => void refresh(true)}>Retry</Button>
        </div>
      );
    }
    // `lastRefreshAt === null` covers the first render, before the refresh
    // effect has flipped `status` to "loading".
    if (empty && (state.status === "loading" || state.lastRefreshAt === null)) {
      return <Spinner label="Loading exercises…" />;
    }

    return (
      <div className={styles.picker}>
        <input
          type="search"
          className={styles.search}
          aria-label="Search exercises"
          placeholder="Search exercises…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        {muscles.data && equipment.data ? (
          <div className={styles.filters}>
            <select
              className={styles.chip}
              aria-label="Muscle"
              value={muscleId ?? ""}
              onChange={(event) => setMuscleId(event.target.value || null)}
            >
              <option value="">All muscles</option>
              {muscles.data.map((muscle) => (
                <option key={muscle.id} value={muscle.id}>
                  {muscle.name}
                </option>
              ))}
            </select>
            <select
              className={styles.chip}
              aria-label="Equipment"
              value={equipmentId ?? ""}
              onChange={(event) => setEquipmentId(event.target.value || null)}
            >
              <option value="">All equipment</option>
              {equipment.data.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {!narrowing && recents.length > 0 ? (
          <section aria-labelledby={recentHeadingId}>
            <h3 className={styles.heading} id={recentHeadingId}>
              Recent
            </h3>
            <ul className={styles.list}>{recents.map((exercise) => row(exercise, "recent"))}</ul>
          </section>
        ) : null}

        <section aria-labelledby={allHeadingId}>
          <h3 className={styles.heading} id={allHeadingId}>
            All exercises
          </h3>
          {listed.length === 0 ? <p className={styles.empty}>No exercises match</p> : null}
          <ul className={styles.list}>
            {listed.map((exercise) => row(exercise, narrowing ? "search" : "list"))}
            <li>
              <button type="button" className={styles.createRow} onClick={() => setView("create")}>
                {query === "" ? "Create a custom exercise" : `Can't find it? Create "${query}"`}
              </button>
            </li>
          </ul>
        </section>
      </div>
    );
  };

  return (
    <Sheet
      open={open}
      title={view === "create" ? "Create exercise" : "Add exercise"}
      onClose={onClose}
    >
      {view === "create" ? (
        <CreateExerciseForm
          initialName={query}
          muscleGroups={muscles.data}
          equipment={equipment.data}
          onCreated={(exercise) => {
            // `createCustom` already recorded the pick and tracked the create.
            setView("list");
            onPick(exercise);
          }}
          onCancel={() => setView("list")}
        />
      ) : (
        renderList()
      )}
    </Sheet>
  );
}
