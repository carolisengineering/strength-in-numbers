import { lineageRootId, sinEquipmentToHevy, sinMuscleToHevy, type HevyTemplate, type HevyType, type UnmappedExercise } from "@sin/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { reportError } from "../../../observability/reportError";
import { Button } from "../../../ui/Button";
import { Sheet } from "../../../ui/Sheet";
import { MODALITY_LABELS } from "../../catalog/labels";
import { useCatalog } from "../../catalog/useCatalog";
import { HevyError } from "../client/hevyErrors";
import { HEVY_TYPE_LABELS } from "../labels";
import { useHevyMapping } from "../mapping/useHevyMapping";
import { mappingErrorMessage, useMappingMutations } from "../mapping/useMappingMutations";
import { hevyTemplatesQuery, useHevyTemplates } from "../mapping/useHevyTemplates";
import { useHevyClient } from "../useHevyClient";
import { acceptableTemplates, allowedHevyTypes, canContinue, createDraftFor, initialExportCards, leftOut, upsertsFor, type CreateDraft, type ExportCard } from "./exportPairing";
import { hevyExerciseCreateBody } from "./hevyExerciseCreateBody";
import { HEVY_SEND_COPY as C, hevyFailureSentence } from "./messages";
import styles from "./MatchForHevySheet.module.css";

// Plan copy.
const SEARCH_LABEL = "Search Hevy exercises";
const LOADING = "Loading Hevy exercises…";
const CREATED = "Created in Hevy.";
const pairedWith = (title: string) => `Paired with ${title}`;
const LEFT_OUT = "Left out of this workout.";
const CHANGE = "Change";

type Mode = "choose" | "pick" | "create";

// Plan copy.
const ALREADY_IN_HEVY = "Hevy already has an exercise with this title. Pick it instead.";
const AT_LEAST_ONE = "At least one exercise has to go to Hevy.";
const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** Whether Hevy already holds a custom exercise with this title (code review 1/2). */
const hasCustomTitled = (templates: readonly HevyTemplate[] | undefined, title: string) => (templates ?? []).some((t) => t.is_custom && sameTitle(t.title, title));

/**
 * Spec 20.2 AC13 / AC14, §5.2: "Match exercises for Hevy" — one card per unmapped exercise: pick a Hevy exercise,
 * create one in Hevy (after a confirmation, once, never retried), or leave it out of this send. Continue saves the
 * picks and creates as pairs (one `PATCH`), then hands back the exercises left out. Mounted only while open, because
 * it reads Hevy's template list.
 */
export function MatchForHevySheet({
  unmapped,
  exerciseCount,
  onCancel,
  onDone,
}: {
  unmapped: readonly UnmappedExercise[];
  /** The workout's distinct exercises: leaving every one out would send an empty workout (code review 8). */
  exerciseCount: number;
  onCancel: () => void;
  onDone: (leaveOut: Set<string>) => void;
}) {
  const templates = useHevyTemplates();
  const mapping = useHevyMapping();
  const { patch } = useMappingMutations();
  const catalog = useCatalog();
  const client = useHevyClient();
  const queryClient = useQueryClient();
  const rows = catalog.state.rows;
  const rootOf = useMemo(() => {
    const roots = new Map<string, string>(rows.map((r) => [r.id, lineageRootId(r)]));
    return (id: string) => roots.get(id) ?? id;
  }, [rows]);
  const [cards, setCards] = useState<ExportCard[]>(() => initialExportCards(unmapped, mapping.data ?? { pairs: [], sectionRules: [] }, rootOf));
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, CreateDraft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** AC14: one create per card, never twice (a ref, so two clicks in one tick make one request). */
  const creating = useRef(new Set<string>());
  /**
   * Final review I4: what Hevy already created for each exercise on this sheet. Hevy can't delete a custom exercise, so
   * Change then Create in Hevy reuses it instead of making a second one.
   */
  const created = useRef(new Map<string, { draft: CreateDraft; id: string }>());

  // AC21: focus moves to the sheet's heading on open.
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const heading = marker.current?.closest("dialog")?.querySelector("h2");
    if (heading instanceof HTMLElement) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, []);

  const setChoice = (id: string, choice: ExportCard["choice"]) => setCards((cs) => cs.map((c) => (c.exercise.exerciseId === id ? { ...c, choice } : c)));
  const setMode = (id: string, mode: Mode) => setModes((m) => ({ ...m, [id]: mode }));

  const startCreate = (exercise: UnmappedExercise) => {
    const made = created.current.get(exercise.exerciseId);
    if (made) {
      setChoice(exercise.exerciseId, { kind: "create", draft: made.draft, created: { id: made.id } });
      return;
    }
    const row = rows.find((r) => r.id === exercise.exerciseId);
    setDrafts((d) => ({ ...d, [exercise.exerciseId]: d[exercise.exerciseId] ?? createDraftFor(exercise, row) }));
    setErrors((e) => ({ ...e, [exercise.exerciseId]: "" }));
    setMode(exercise.exerciseId, "create");
  };

  const confirmCreate = async (exercise: UnmappedExercise) => {
    const id = exercise.exerciseId;
    const draft = drafts[id];
    if (!draft || client === null || creating.current.has(id)) return;
    creating.current.add(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      // Hevy can't delete a custom exercise: read its list fresh, and never make a second one with this title (a lost
      // reply may have made the first; code review 1/2).
      const fresh = await queryClient.fetchQuery({ ...hevyTemplatesQuery(client), staleTime: 0 });
      if (hasCustomTitled(fresh, draft.title)) return;
      const reply = await client.createTemplate(hevyExerciseCreateBody(draft));
      created.current.set(id, { draft, id: reply.id });
      const choice = { kind: "create" as const, draft, created: { id: reply.id } };
      setChoice(id, choice);
      // Saved at once, so a Cancel can't leave Hevy holding an exercise nothing pairs (Continue saves it again).
      patch.mutateAsync({ upsert: upsertsFor([{ exercise, choice }]) }).catch(() => {});
    } catch (err) {
      if (err instanceof HevyError && err.kind === "limit") {
        setErrors((e) => ({ ...e, [id]: C.templateLimit }));
        setChoice(id, null);
        setMode(id, "choose");
      } else {
        const kind = err instanceof HevyError ? err.kind : "unexpected_reply";
        if (kind === "server" || kind === "unexpected_reply") reportError(err, { source: "hevy-send", op: "create-template" });
        setErrors((e) => ({ ...e, [id]: hevyFailureSentence(kind) }));
      }
    } finally {
      creating.current.delete(id);
    }
  };

  const allLeftOut = leftOut(cards).size >= exerciseCount;

  const proceed = async () => {
    if (!canContinue(cards) || allLeftOut || saving) return;
    setSaving(true);
    setSaveError(null);
    const upsert = upsertsFor(cards);
    try {
      if (upsert.length > 0) await patch.mutateAsync({ upsert });
    } catch (err) {
      setSaveError(mappingErrorMessage(err));
      setSaving(false);
      return;
    }
    onDone(leftOut(cards));
  };

  return (
    <Sheet open title={C.matchTitle} onClose={onCancel} dismissible={!saving}>
      <div ref={marker} className={styles.body}>
        {cards.map(({ exercise, choice }) => {
          const id = exercise.exerciseId;
          const mode = choice !== null ? null : (modes[id] ?? "choose");
          const draft = drafts[id];
          const query = (searches[id] ?? "").trim().toLowerCase();
          const options = acceptableTemplates(templates.data ?? [], exercise.modality).filter((t) => t.title.toLowerCase().includes(query));
          return (
            <fieldset key={id} className={styles.card}>
              <legend className={styles.name}>{exercise.name}</legend>
              <p className={styles.meta}>{`${MODALITY_LABELS[exercise.modality]} · ${C.usedHere}`}</p>
              {errors[id] ? (
                <p className={styles.error} role="alert">
                  {errors[id]}
                </p>
              ) : null}
              {choice !== null ? (
                <div className={styles.row}>
                  <p className={styles.text}>
                    {choice.kind === "pick" ? pairedWith(choice.template.title) : choice.kind === "create" ? CREATED : LEFT_OUT}
                  </p>
                  <Button variant="secondary" onClick={() => (setChoice(id, null), setMode(id, "choose"))}>
                    {CHANGE}
                  </Button>
                </div>
              ) : null}
              {mode === "choose" ? (
                <div className={styles.actions}>
                  <Button variant="secondary" onClick={() => setMode(id, "pick")}>
                    {C.pick}
                  </Button>
                  <Button variant="secondary" onClick={() => startCreate(exercise)}>
                    {C.create}
                  </Button>
                  <Button variant="secondary" onClick={() => setChoice(id, { kind: "leave" })}>
                    {C.leaveOut}
                  </Button>
                </div>
              ) : null}
              {mode === "pick" ? (
                <div className={styles.pick}>
                  <input
                    type="search"
                    className={styles.search}
                    aria-label={SEARCH_LABEL}
                    value={searches[id] ?? ""}
                    onChange={(e) => setSearches((s) => ({ ...s, [id]: e.target.value }))}
                  />
                  {templates.isPending ? <p className={styles.text}>{LOADING}</p> : null}
                  {templates.isError && templates.data === undefined ? (
                    <div className={styles.row}>
                      <p className={styles.error} role="alert">
                        {hevyFailureSentence(templates.error instanceof HevyError ? templates.error.kind : "unexpected_reply")}
                      </p>
                      <Button variant="secondary" onClick={() => void templates.refetch()}>
                        {C.tryAgain}
                      </Button>
                    </div>
                  ) : null}
                  <ul className={styles.options}>
                    {options.map((t) => (
                      <li key={t.id}>
                        <Button variant="secondary" onClick={() => setChoice(id, { kind: "pick", template: t })}>
                          {`${t.title} · ${HEVY_TYPE_LABELS[t.type!]}`}
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <Button variant="secondary" onClick={() => setMode(id, "choose")}>
                    {C.cancel}
                  </Button>
                </div>
              ) : null}
              {mode === "create" && draft ? (
                <div className={styles.create}>
                  <label className={styles.field}>
                    <span>Title</span>
                    <input type="text" value={draft.title} onChange={(e) => setDrafts((d) => ({ ...d, [id]: { ...draft, title: e.target.value } }))} />
                  </label>
                  <label className={styles.field}>
                    <span>Hevy type</span>
                    <select value={draft.hevyType} onChange={(e) => setDrafts((d) => ({ ...d, [id]: { ...draft, hevyType: e.target.value as HevyType } }))}>
                      {allowedHevyTypes(exercise.modality).map((t) => (
                        <option key={t} value={t}>
                          {HEVY_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className={styles.meta}>{`Primary muscle: ${sinMuscleToHevy(draft.primaryMuscle)}`}</p>
                  <p className={styles.meta}>{`Other muscles: ${[...new Set(draft.otherMuscles.map(sinMuscleToHevy))].join(", ") || "none"}`}</p>
                  <p className={styles.meta}>{`Equipment: ${sinEquipmentToHevy(draft.equipment)}`}</p>
                  <p className={styles.text}>{C.createWarning}</p>
                  <div className={styles.actions}>
                    <Button variant="secondary" onClick={() => setMode(id, "choose")}>
                      {C.cancel}
                    </Button>
                    {hasCustomTitled(templates.data, draft.title) ? <p className={styles.error}>{ALREADY_IN_HEVY}</p> : null}
                    <Button
                      variant="secondary"
                      disabled={draft.title.trim() === "" || hasCustomTitled(templates.data, draft.title)}
                      onClick={() => void confirmCreate(exercise)}
                    >
                      {C.create}
                    </Button>
                  </div>
                </div>
              ) : null}
            </fieldset>
          );
        })}
        {saveError !== null ? (
          <p className={styles.error} role="alert">
            {saveError}
          </p>
        ) : null}
        {allLeftOut ? <p className={styles.text}>{AT_LEAST_ONE}</p> : null}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            {C.cancel}
          </Button>
          <Button variant="secondary" disabled={!canContinue(cards) || allLeftOut || saving} busy={saving} onClick={() => void proceed()}>
            {C.continue}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
