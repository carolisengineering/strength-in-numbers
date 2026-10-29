import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { ApiError } from "../../../api";
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
import { runDryRun } from "./dryRun";
import { ImportReplyError, useHevyImportClient } from "./hevyImportClient";
import { sortNewestFirst, toImportWorkout } from "./importRequest";
import { deviceZone } from "./PreflightStep";
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
  const importClient = useHevyImportClient();
  const checking = useRef(false);

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

  /**
   * AC11: the summary's dry run, against the mapping as saved now. Unreadable workouts (AC6, O2) are never sent; the
   * rest go newest first. The mapping reference is kept for the stale rule (AC28).
   */
  const runCheck = useCallback(() => {
    const current = stateRef.current;
    if (current.read === null || mapping.data === undefined) return;
    stopIo();
    const io = new AbortController();
    controller.current = io;
    checking.current = true;
    const gen = nextGeneration();
    const zone = deviceZone();
    const unreadable: string[] = [];
    const workouts = sortNewestFirst([...current.read.workouts.values()]).flatMap((w) => {
      const built = toImportWorkout(w, { zone });
      if (built.ok) return [built.workout];
      unreadable.push(w.id);
      return [];
    });
    dispatch({ type: "checkStart", generation: gen, mapping: mapping.data, unreadable });
    runDryRun(importClient, workouts, { signal: io.signal, onProgress: (done, total) => dispatch({ type: "checkProgress", generation: gen, done, total }) }).then(
      (results) => {
        checking.current = false;
        if (!io.signal.aborted) dispatch({ type: "checked", generation: gen, results });
      },
      (err: unknown) => {
        checking.current = false;
        if (io.signal.aborted) return;
        const network = err instanceof ApiError && err.isNetworkError;
        const failure = err instanceof ImportReplyError ? "reply" : network ? "network" : "failed";
        if (err instanceof ImportReplyError || !(err instanceof ApiError) || err.status >= 500) reportError(err, { source: "hevy-import", op: "summary" });
        dispatch({ type: "checkFailed", generation: gen, failure });
      },
    );
  }, [mapping.data, importClient, stopIo]);

  useEffect(() => {
    if (state.step !== "checking" || state.results !== null || state.summaryError !== null || checking.current) return;
    runCheck();
  }, [state.step, state.results, state.summaryError, runCheck]);

  /** Back to an earlier step: anything in flight stops first, so a late reply can't land on the step left. */
  const back = useCallback(
    (to: ImportState["step"]) => {
      stopIo();
      checking.current = false;
      dispatch({ type: "back", to });
    },
    [stopIo],
  );

  /**
   * AC13 **Back to names**: an `unpaired` result means the mapping changed since it was read (a pair removed, an
   * exercise retired), so read it again before the flow derives the needs.
   */
  const backToNames = useCallback(async () => {
    stopIo();
    const io = new AbortController();
    controller.current = io;
    await mapping.refetch();
    // A Back, Cancel or unmount while the mapping was read wins: the late answer moves nothing.
    if (io.signal.aborted || stateRef.current.step !== "summary") return;
    controller.current = null;
    dispatch({ type: "goto", step: "preparing" });
  }, [mapping, stopIo]);

  const recheck = useCallback(() => {
    checking.current = false;
    dispatch({ type: "recheck" });
  }, []);

  return {
    state,
    dispatch,
    recheck,
    back,
    backToNames,
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
    /** The mapping, or the first catalog sync, failed while the flow waited for it. */
    preparingFailed: state.step === "preparing" && (mapping.isError || (!synced && catalog.state.status === "error")),
    retryPreparing: () => {
      if (mapping.isError) void mapping.refetch();
      if (!synced) void catalog.refresh(true);
    },
  };
}
