import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { lineageRootId, translateHevyRoutine, type HevyImportResult, type HevyImportWorkout } from "@sin/core";

import { ApiError } from "../../../api";
import { reportError } from "../../../observability/reportError";
import { useCatalog } from "../../catalog/useCatalog";
import { ME_QUERY_KEY, useMe } from "../../me/useMe";
import { applyImportedCaches } from "../../records/cache";
import { HevyError } from "../client/hevyErrors";
import { HEVY_KEYS } from "../keys";
import { useHevyMapping } from "../mapping/useHevyMapping";
import { hevyTemplatesQuery } from "../mapping/useHevyTemplates";
import { initialPairingCards, newPairingSaveRecord, savePairings } from "../pairing";
import { useSavePairingsDeps } from "../pairing/useSavePairingsDeps";
// Spec 20.1 D11 / D16 (owner ruling 2026-10-29): the one file in features/hevy that may use the routines list and create.
import { useRoutines } from "../../routines/queries";
import { useCreateRoutine } from "../../routines/useRoutineMutations";
import { useHevyClient } from "../useHevyClient";
import { useHevyKey } from "../useHevyKey";
import { useHevyStatus } from "../useHevyStatus";
import { createRoutines } from "./createRoutines";
import { finishImport, needsFinish } from "./finishImport";
import {
  importSession,
  initialImportState,
  isSummaryStale,
  needsFor,
  nextStepAfterRoutines,
  pickedRoutines,
  type ImportState,
  type ReadFailure,
} from "./importSession";
import { importWait } from "./importWait";
import { ADD_KEY_FIRST, IMPORT_UNAVAILABLE, MAPPING_UNAVAILABLE } from "./messages";
import { runBatches, runImport } from "./runImport";
import { runDryRun } from "./dryRun";
import { ImportReplyError, useHevyImportClient } from "./hevyImportClient";
import { sortNewestFirst, toImportWorkout } from "./importRequest";
import { deviceZone } from "./PreflightStep";
import { readHevy, ReadStageError, type ReadStage } from "./readHevy";
import { routineNameKey, tickAllInFolder, toggle, type PickContext, type RoutineGroup } from "./routinePicks";

/** AC28: the run can start only with a `200` status, a stored key, a loaded mapping and a summary that isn't stale. */
export function canStartRun(ctx: { statusOk: boolean; hasKey: boolean; mappingOk: boolean; stale: boolean }): boolean {
  return ctx.statusOk && ctx.hasKey && ctx.mappingOk && !ctx.stale;
}

/** §9: only failures worth a look are reported — not a network error, not a `4xx`. */
const reportable = (err: unknown) => err instanceof ImportReplyError || !(err instanceof ApiError) || (!err.isNetworkError && err.status >= 500);

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

  // ---- Phase B: the run, the finish, the routines (AC16–AC28) ----

  const status = useHevyStatus();
  const hevyKey = useHevyKey();
  const me = useMe();
  const createRoutine = useCreateRoutine();
  /** Aborted on unmount only: a Stop has its own signal. A fresh one per mount (StrictMode re-mounts in dev). */
  const alive = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    alive.current = controller;
    return () => controller.abort();
  }, []);
  /** AC20: one runner at a time (a run, a resume, a finish up or a finish retry), guarded by a ref. */
  const busy = useRef(false);
  const stopRequested = useRef(false);
  const stopController = useRef<AbortController | null>(null);
  const [stopping, setStopping] = useState(false);
  const batchesRef = useRef<HevyImportWorkout[][]>([]);
  /** The run's results as the runner reports them (the reducer's copy lags a render behind the last batch). */
  const runResults = useRef<HevyImportResult[]>([]);
  const latest = useRef({ status: status.data, mapping: mapping.data, rows: catalog.state.rows, unit: me.data?.unitPreference, create: createRoutine.mutateAsync });
  latest.current = { status: status.data, mapping: mapping.data, rows: catalog.state.rows, unit: me.data?.unitPreference, create: createRoutine.mutateAsync };

  const stale = isSummaryStale(state, mapping.data);
  const startContext = { statusOk: status.isSuccess, hasKey: hevyKey.hasKey, mappingOk: mapping.isSuccess, stale };
  const startRef = useRef(startContext);
  startRef.current = startContext;
  const importBlocked = !hevyKey.hasKey ? ADD_KEY_FIRST : !status.isSuccess ? IMPORT_UNAVAILABLE : !mapping.isSuccess ? MAPPING_UNAVAILABLE : null;

  /** AC22, AC23: the finish when needed (it waits on the lane for any batch in flight), then the ticked routines. */
  const wrapUp = useCallback(
    async (signal: AbortSignal) => {
      if (needsFinish(runResults.current, latest.current.status)) {
        dispatch({ type: "finishStart" });
        const outcome = await finishImport(importClient);
        if (signal.aborted) return;
        if (outcome === "ok") applyImportedCaches(queryClient);
        dispatch({ type: "finishDone", ok: outcome === "ok" });
      }
      const picked = pickedRoutines(stateRef.current);
      if (picked.length === 0) return dispatch({ type: "toDone" });
      dispatch({ type: "routinesStart", total: picked.length });
      const { mapping: saved, rows, unit } = latest.current;
      const ctx: Parameters<typeof translateHevyRoutine>[1] = {
        pairs: new Map((saved?.pairs ?? []).map((p) => [p.hevyTemplateId, p])),
        // Every synced row, not only the visible ones: a fork's origin counts too (as the server loads it).
        exercises: new Map(rows.map((row) => [row.id, { name: row.name, modality: row.modality, active: row.isActive, rootId: lineageRootId(row) }])),
        unit: unit ?? "kg",
      };
      const outcomes = await createRoutines(picked, {
        // D11: the existing create, `{ body }` only — never `oneOff`.
        create: (body) => latest.current.create({ body }),
        translate: (routine) => translateHevyRoutine(routine, ctx),
        sleep: importWait,
        signal,
        onProgress: (done, total) => dispatch({ type: "routinesProgress", done, total }),
      });
      if (signal.aborted) return;
      dispatch({ type: "routinesDone", outcomes });
    },
    [importClient, queryClient],
  );

  /** AC16–AC20: drives `runImport` from batch `from`; a late event of an older generation is dropped by the reducer. */
  const drive = useCallback(
    async (gen: number, from: number) => {
      const signal = alive.current.signal;
      const stop = new AbortController();
      stopController.current = stop;
      stopRequested.current = false;
      const batches = batchesRef.current;
      let ended = false;
      try {
        await runImport(
          { importBatch: (body, s) => importClient.importBatch(body, s), sleep: importWait, signal, stopSignal: stop.signal, shouldStop: () => stopRequested.current },
          batches,
          from,
          {
            batchDone: (index, results) => {
              runResults.current = [...runResults.current, ...results];
              dispatch({ type: "batchDone", generation: gen, results, nextDate: batches[index + 1]?.[0]?.startTime ?? null });
            },
            paused: (_index, reason, err) => {
              if (reportable(err)) reportError(err, { source: "hevy-import", op: "batch" });
              dispatch({ type: "runPaused", generation: gen, reason });
            },
            stopped: (_index, reason, err) => {
              if (err !== undefined && reportable(err)) reportError(err, { source: "hevy-import", op: "batch" });
              // O3 / D19: a deleted account hands over to the layout (CLAUDE.md "Account lifecycle UI").
              if (err instanceof ApiError && err.status === 403 && err.type === "account-deleted") void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
              dispatch({ type: "runStopped", generation: gen, reason });
            },
            ended: () => {
              ended = true;
            },
          },
        );
      } finally {
        stopController.current = null;
        setStopping(false);
      }
      // AC24: what the run wrote is on the server now (a batch in flight always lands first), even if the screen is gone.
      applyImportedCaches(queryClient);
      if (signal.aborted || !ended) {
        busy.current = false;
        return;
      }
      try {
        await wrapUp(signal);
      } finally {
        busy.current = false;
      }
    },
    [importClient, queryClient, wrapUp],
  );

  /** AC16 **Import**: the dry run's `create` and `duplicate` workouts, newest first, in real batches. */
  const run = useCallback(() => {
    const current = stateRef.current;
    if (busy.current || current.step !== "summary" || current.results === null || current.read === null || !canStartRun(startRef.current)) return;
    busy.current = true;
    batchesRef.current = runBatches(current.results, current.read.workouts, deviceZone());
    runResults.current = [];
    const total = batchesRef.current.reduce((n, b) => n + b.length, 0);
    const gen = nextGeneration();
    dispatch({ type: "runStart", generation: gen, total, batchDate: batchesRef.current[0]?.[0]?.startTime ?? null });
    void drive(gen, 0);
  }, [drive]);

  /** AC19 / AC20 **Resume**: re-sends from the first batch not done (the failed one); the server skips what landed. */
  const resume = useCallback(() => {
    const current = stateRef.current;
    if (busy.current || (current.step !== "paused" && current.step !== "stopped") || current.run === null) return;
    busy.current = true;
    const gen = nextGeneration();
    dispatch({ type: "resume", generation: gen });
    void drive(gen, current.run.batchesDone);
  }, [drive]);

  /** AC20 **Stop**: the batch in flight finishes, then the run stops; a pending wait ends at once. */
  const stop = useCallback(() => {
    const current = stateRef.current;
    if (current.step === "paused") {
      dispatch({ type: "runStopped", generation: current.generation, reason: { kind: "user" } });
      return;
    }
    if (current.step !== "running") return;
    stopRequested.current = true;
    stopController.current?.abort();
    setStopping(true);
  }, []);

  /** AC20 / §6.8 **Finish up** after a stop: the finish if needed, then the routines, then done. */
  const finishUp = useCallback(() => {
    if (busy.current || stateRef.current.step !== "stopped") return;
    busy.current = true;
    void wrapUp(alive.current.signal).finally(() => {
      busy.current = false;
    });
  }, [wrapUp]);

  /** AC22 **Try again** on the done screen. */
  const retryFinish = useCallback(async () => {
    if (busy.current || stateRef.current.step !== "done") return;
    busy.current = true;
    const signal = alive.current.signal;
    dispatch({ type: "finishStart" });
    const outcome = await finishImport(importClient);
    busy.current = false;
    if (signal.aborted) return;
    if (outcome === "ok") applyImportedCaches(queryClient);
    dispatch({ type: "finishDone", ok: outcome === "ok" });
  }, [importClient, queryClient]);

  /** AC19: coming back online while paused offers Resume (it never resumes by itself). */
  const [backOnline, setBackOnline] = useState(false);
  useEffect(() => {
    setBackOnline(false);
    if (state.step !== "paused") return;
    const onOnline = () => setBackOnline(true);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [state.step]);

  return {
    run,
    resume,
    stop,
    stopping,
    finishUp,
    retryFinish,
    backOnline,
    importBlocked,
    canImport: canStartRun(startContext),
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
