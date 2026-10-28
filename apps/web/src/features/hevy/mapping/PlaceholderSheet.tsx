import type { HevyTemplate } from "@sin/core";
import { useEffect, useMemo, useRef, useState } from "react";

import { reportError } from "../../../observability/reportError";
import { Button } from "../../../ui/Button";
import { Sheet } from "../../../ui/Sheet";
import { HevyError } from "../client/hevyErrors";
import {
  HEVY_COPY,
  MAPPING_LOADING,
  MARKER_NONE,
  MARKERS_SHEET_TITLE,
  MARKER_WARMUP,
  MARKER_WORKOUT,
  NO_KEY_FOR_FILE,
  SAVE_MARKERS,
  SEARCH_HEVY_EXERCISES,
} from "../messages";
import { useHevyClient } from "../useHevyClient";
import { useHevyTemplates } from "./useHevyTemplates";
import { classifyMappingError, mappingErrorMessage, useMappingMutations, type PairInput } from "./useMappingMutations";
import styles from "./PlaceholderSheet.module.css";

const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export interface PlaceholderSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Spec 20.0 AC30: choose the Hevy exercises that mark a Warmup section and any other section. Both are optional;
 * templates titled exactly "Warmup" and "workout" start chosen. Reading the list needs the key; saving is one `PATCH`.
 */
export function PlaceholderSheet({ open, onClose }: PlaceholderSheetProps) {
  const client = useHevyClient();
  const templates = useHevyTemplates();
  const { patch } = useMappingMutations();
  const [query, setQuery] = useState("");
  const [warmup, setWarmup] = useState<string | null>(null);
  const [workout, setWorkout] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Pre-select the exact titles once, when the list first arrives (case-sensitive: the file would not guess either);
  // a later re-read must not overwrite what the lifter chose.
  const preselected = useRef(false);
  useEffect(() => {
    if (!open || templates.data === undefined || preselected.current) return;
    preselected.current = true;
    setWarmup(templates.data.find((t) => t.title === MARKER_WARMUP)?.id ?? null);
    setWorkout(templates.data.find((t) => t.title === MARKER_WORKOUT)?.id ?? null);
  }, [open, templates.data]);

  const shown = useMemo(() => {
    const all = templates.data ?? [];
    const q = fold(query.trim());
    return q === "" ? all : all.filter((t) => fold(t.title).includes(q));
  }, [templates.data, query]);

  function save() {
    const byId = new Map((templates.data ?? []).map((t) => [t.id, t]));
    const upsert: PairInput[] = [];
    const add = (id: string | null, role: "warmup_placeholder" | "workout_placeholder") => {
      const t = id === null ? undefined : byId.get(id);
      if (t !== undefined) upsert.push({ hevyTemplateId: t.id, hevyTitle: t.title, hevyType: t.type, role, exerciseId: null, measureRule: null, exportAs: false });
    };
    add(warmup, "warmup_placeholder");
    add(workout, "workout_placeholder");
    if (upsert.length === 0) return onClose();
    setFailure(null);
    patch.mutate(
      { upsert },
      {
        onSuccess: () => onClose(),
        onError: (err) => {
          const kind = classifyMappingError(err);
          if (kind === "other") reportError(err, { source: "hevy", op: "mapping-patch" });
          setFailure(mappingErrorMessage(err));
        },
      },
    );
  }

  const group = (label: string, value: string | null, set: (id: string | null) => void, name: string) => (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{label}</legend>
      <label className={styles.option}>
        <input type="radio" name={name} checked={value === null} onChange={() => set(null)} />
        <span>{MARKER_NONE}</span>
      </label>
      {shown.map((t: HevyTemplate) => (
        <label key={t.id} className={styles.option}>
          <input type="radio" name={name} checked={value === t.id} onChange={() => set(t.id)} />
          <span>{t.title}</span>
        </label>
      ))}
    </fieldset>
  );

  return (
    <Sheet open={open} title={MARKERS_SHEET_TITLE} onClose={onClose} dismissible={!patch.isPending}>
      {client === null ? (
        <p role="status">{NO_KEY_FOR_FILE}</p>
      ) : templates.isPending ? (
        <p role="status">{MAPPING_LOADING}</p>
      ) : templates.isError ? (
        <p role="alert">{templates.error instanceof HevyError ? HEVY_COPY[templates.error.kind] : HEVY_COPY.unexpected_reply}</p>
      ) : (
        <div className={styles.body}>
          <input
            className={styles.search}
            type="search"
            aria-label={SEARCH_HEVY_EXERCISES}
            placeholder={`${SEARCH_HEVY_EXERCISES}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {group(MARKER_WARMUP, warmup, setWarmup, "hevy-marker-warmup")}
          {group(MARKER_WORKOUT, workout, setWorkout, "hevy-marker-workout")}
          {failure !== null ? <p role="alert">{failure}</p> : null}
          <Button busy={patch.isPending} disabled={patch.isPending} onClick={save}>
            {SAVE_MARKERS}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
