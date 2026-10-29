import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { reportError } from "../../../observability/reportError";
import { useCatalog } from "../../catalog/useCatalog";
import { HevyError } from "../client/hevyErrors";
import { HEVY_KEYS } from "../keys";
import { useHevyMapping } from "../mapping/useHevyMapping";
import { hevyTemplatesQuery } from "../mapping/useHevyTemplates";
import { initialPairingCards, newPairingSaveRecord, savePairings } from "../pairing";
import { useSavePairingsDeps } from "../pairing/useSavePairingsDeps";
// Spec 20.1 D11 / owner ruling 2026-10-29: the one file in features/hevy that may use the routines list.
import { useRoutines } from "../../routines/queries";
import { useHevyClient } from "../useHevyClient";
import { importSession, initialImportState, needsFor, nextStepAfterRoutines, type ImportState, type ReadFailure } from "./importSession";
import { readHevy, ReadStageError, type ReadStage } from "./readHevy";
import { routineNameKey, tickAllInFolder, toggle, type PickContext, type RoutineGroup } from "./routinePicks";

/**
 * Spec 20.1 §6.1: wires the import's I/O to the reducer. One `AbortController` per I/O, aborted on unmount and on
 * Cancel; every I/O result carries the generation it started under. The Hevy data lives only here, in memory, and
 * goes when the screen unmounts (AC15).
 */
export function useImportSession() {
  const [state, dispatch] = useReducer(importSession, initialImportState);
  const client = useHevyClient();
  const queryClient = useQueryClient();
  const mapping = useHevyMapping();
  const catalog = useCatalog();
  const synced = catalog.state.syncToken !== null;
  const routinesList = useRoutines();
  const saveDeps = useSavePairingsDeps();
  /** One save record per screen mount (never stored), so a second Continue reuses what an earlier one created. */
  const saveRecord = useRef(newPairingSaveRecord());

  const generation = useRef(state.generation);
  const controller = useRef<AbortController | null>(null);
  /** Minor 231: cancel the shared template read only if this read started it. */
  const startedTemplates = useRef(false);
  const stateRef = useRef<ImportState>(state);
  stateRef.current = state;

  const stopIo = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    if (startedTemplates.current) void queryClient.cancelQueries({ queryKey: HEVY_KEYS.templates });
    startedTemplates.current = false;
  }, [queryClient]);

  useEffect(() => stopIo, [stopIo]);

  const nextGeneration = () => {
    generation.current = Math.max(generation.current, stateRef.current.generation) + 1;
    return generation.current;
  };

  const runRead = useCallback(
    (gen: number, from?: ReadStage, previous?: ReadFailure) => {
      if (client === null) {
        dispatch({ type: "readFailed", generation: gen, failure: { kind: "bad_key" } });
        return;
      }
      stopIo();
      const io = new AbortController();
      controller.current = io;
      const templates = () => {
        const running = queryClient.isFetching({ queryKey: HEVY_KEYS.templates }) > 0;
        const cached = queryClient.getQueryState(HEVY_KEYS.templates)?.status === "success";
        startedTemplates.current = !running && !cached;
        return queryClient.fetchQuery(hevyTemplatesQuery(client));
      };
      readHevy(client, {
        signal: io.signal,
        templates,
        ...(from ? { from } : {}),
        ...(previous?.kind === "stage" ? { previous: previous.partial } : {}),
        onProgress: (progress) => dispatch({ type: "readProgress", generation: gen, progress }),
      }).then(
        (read) => {
          startedTemplates.current = false;
          if (!io.signal.aborted) dispatch({ type: "readDone", generation: gen, read });
        },
        (err: unknown) => {
          startedTemplates.current = false;
          if (io.signal.aborted) return;
          if (err instanceof ReadStageError) {
            if (err.cause.kind === "server") reportError(err.cause, { source: "hevy-import", op: "read" });
            const cause = err.cause.kind === "network" ? "network" : "other";
            dispatch({ type: "readFailed", generation: gen, failure: { kind: "stage", stage: err.stage, cause, partial: err.partial } });
          } else if (err instanceof HevyError && err.kind === "bad_key") {
            dispatch({ type: "readFailed", generation: gen, failure: { kind: "bad_key" } });
          } else {
            reportError(err, { source: "hevy-import", op: "read" });
            dispatch({ type: "readFailed", generation: gen, failure: { kind: "unexpected_reply" } });
          }
        },
      );
    },
    [client, queryClient, stopIo],
  );

  const start = useCallback(() => {
    const gen = nextGeneration();
    dispatch({ type: "start", generation: gen });
    runRead(gen);
  }, [runRead]);

  /** AC5 **Try again**: restarts the failed stage with what was read before it. */
  const retryRead = useCallback(() => {
    const failure = stateRef.current.readError;
    const gen = nextGeneration();
    dispatch({ type: "retryRead", generation: gen });
    runRead(gen, failure?.kind === "stage" ? failure.stage : undefined, failure ?? undefined);
  }, [runRead]);

  const cancel = useCallback(() => {
    stopIo();
    generation.current = Math.max(generation.current, stateRef.current.generation) + 1;
    dispatch({ type: "cancel" });
  }, [stopIo]);

  /** Leaves the routines step (or a skipped markers step) for markers, names or checking. */
  const flowContext = useMemo(
    () => (mapping.data !== undefined && synced ? { mapping: mapping.data, catalog: { visible: catalog.visible, synced } } : null),
    [mapping.data, synced, catalog.visible],
  );
  useEffect(() => {
    if (state.step !== "preparing" || flowContext === null) return;
    const next = nextStepAfterRoutines(state, flowContext);
    if (next === "names") {
      const needs = needsFor(state, flowContext);
      dispatch({ type: "goto", step: "names", needs, cards: initialPairingCards(needs, catalog.visible) });
    } else {
      dispatch({ type: "goto", step: next });
    }
  }, [state, flowContext, catalog.visible]);

  // AC7: the cap room and the names SIN already holds, from the routines list.
  const existingNames = useMemo(() => new Set((routinesList.data ?? []).map((r) => routineNameKey(r.name))), [routinesList.data]);
  const routinesById = useMemo(() => new Map((state.read?.routines ?? []).map((r) => [r.id, r])), [state.read]);
  const pickContext: PickContext = useMemo(
    () => ({ picks: state.picks, existingNames, routineCount: routinesList.data?.length ?? 0, routinesById }),
    [state.picks, existingNames, routinesList.data, routinesById],
  );
  const toggleRoutine = useCallback((id: string) => dispatch({ type: "picks", picks: toggle(pickContext.picks, id, pickContext) }), [pickContext]);
  const tickAll = useCallback((group: RoutineGroup) => dispatch({ type: "picks", picks: tickAllInFolder(pickContext.picks, group, pickContext) }), [pickContext]);
  /** Leaves routines (or markers, once the sheet closes): the preparing step decides what comes next. */
  const continueFlow = useCallback(() => dispatch({ type: "goto", step: "preparing" }), []);
  const skipMarkers = useCallback(() => dispatch({ type: "markersSkip" }), []);

  /** AC10: creates the new exercises one at a time and saves the pairs; leaving the screen stops further creates. */
  const saveNames = useCallback(async () => {
    const decisions = stateRef.current.decisions;
    if (decisions === null || stateRef.current.step !== "names") return;
    stopIo();
    const io = new AbortController();
    controller.current = io;
    const creates = decisions.filter((d) => d.action === "create").length;
    dispatch({ type: "namesSaving" });
    const result = await savePairings(
      { decisions, record: saveRecord.current, signal: io.signal, onProgress: (p) => dispatch({ type: "namesProgress", ...p }) },
      saveDeps,
    );
    if (io.signal.aborted) return;
    controller.current = null;
    const created = saveRecord.current.created;
    if (!result.ok) {
      // AC10: what was created stays and is reused. Its card now picks that exercise, because as a New card the name
      // would read as already taken and hold Continue.
      const cards = stateRef.current.cards.map((card) => {
        const made = card.selected === "new" ? created.get(card.templateId) : undefined;
        return made ? { ...card, selected: "picked" as const, pickedId: made.id } : card;
      });
      dispatch({ type: "namesCards", cards });
      dispatch({ type: "namesFailed", message: result.message });
      return;
    }
    // AC24: the catalog is refreshed once after exercises were created.
    if (creates > 0 || created.size > 0) await catalog.refresh(true);
    dispatch({ type: "namesSaved", created: created.size });
  }, [saveDeps, stopIo, catalog]);

  return {
    state,
    dispatch,
    start,
    cancel,
    retryRead,
    routinesList,
    pickContext,
    toggleRoutine,
    tickAll,
    continueFlow,
    skipMarkers,
    saveNames,
    mapping,
    catalog,
    /** The mapping failed to load while the flow waited for it. */
    preparingFailed: state.step === "preparing" && mapping.isError,
  };
}
