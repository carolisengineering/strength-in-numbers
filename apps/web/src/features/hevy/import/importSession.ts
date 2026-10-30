import type { Exercise, HevyImportResult, HevyMapping } from "@sin/core";

import type { PairingCard, PairingDecision, PairingNeed } from "../pairing";
import { markersMissing, pairingNeeds, templatesUsed } from "./importNeeds";
import type { HevyRead, ReadProgress, ReadStage } from "./readHevy";
import type { PickState } from "./routinePicks";
import type { RoutineOutcome } from "./createRoutines";
import type { PauseReason, StopReason } from "./runImport";

/**
 * Spec 20.1 §6.1: the import as a pure reducer. Actions are the user's choices and the I/O results; an I/O result
 * carries the `generation` it was started under, and one from an older generation is ignored (AC3), so
 * a canceled read's late reply never lands. Phase B adds the run's steps.
 */

export type Step =
  | "preflight"
  | "reading"
  /** Waiting for the mapping and the first catalog sync before choosing the next step. */
  | "preparing"
  | "routines"
  | "markers"
  | "names"
  | "saving_names"
  | "checking"
  | "summary"
  /** Phase B: the run (AC16–AC20). */
  | "running"
  | "paused"
  | "stopped"
  /** Phase B: the finish step (AC22), then the routines (AC23), then the done screen (AC25). */
  | "finishing"
  | "routines_run"
  | "done";

/** Phase B: the run's progress. `results` are the run's own (the truth, §6.6); `batchesDone` is where a Resume starts. */
export interface RunState {
  sent: number;
  total: number;
  /** The first start time of the batch in flight, for the month on the progress line. */
  batchDate: string | null;
  batchesDone: number;
  results: HevyImportResult[];
  pause: PauseReason | null;
  stopReason: StopReason | null;
}

export type ReadFailure =
  | { kind: "stage"; stage: ReadStage; cause: "network" | "other"; partial: Partial<HevyRead> }
  | { kind: "bad_key" }
  | { kind: "unexpected_reply" };

export type CheckFailure = "reply" | "failed" | "network";

export interface ImportState {
  step: Step;
  generation: number;
  progress: ReadProgress | null;
  read: HevyRead | null;
  readError: ReadFailure | null;
  picks: PickState;
  markersSkipped: boolean;
  needs: PairingNeed[];
  cards: PairingCard[];
  /** `null` while any card is invalid. */
  decisions: PairingDecision[] | null;
  namesError: string | null;
  namesProgress: { created: number; total: number } | null;
  /** Exercises the names step created (every attempt on this screen), for the summary. */
  exercisesCreated: number;
  checkProgress: { done: number; total: number } | null;
  results: HevyImportResult[] | null;
  unreadable: string[];
  /** The mapping the summary was computed against (AC28: a different one makes it stale). */
  summaryMapping: unknown | null;
  summaryError: CheckFailure | null;
  run: RunState | null;
  /** Phase B: the ticked routines' outcomes (AC23), and the step's progress while it runs. */
  routineResults: RoutineOutcome[];
  routineProgress: { done: number; total: number } | null;
  /** Phase B: the finish step (AC22). `idle` when none was needed. */
  finish: "idle" | "running" | "ok" | "failed";
}

export const initialImportState: ImportState = {
  step: "preflight",
  generation: 0,
  progress: null,
  read: null,
  readError: null,
  picks: { picked: new Set() },
  markersSkipped: false,
  needs: [],
  cards: [],
  decisions: null,
  namesError: null,
  namesProgress: null,
  exercisesCreated: 0,
  checkProgress: null,
  results: null,
  unreadable: [],
  summaryMapping: null,
  summaryError: null,
  run: null,
  routineResults: [],
  routineProgress: null,
  finish: "idle",
};

export type ImportAction =
  | { type: "start"; generation: number }
  | { type: "retryRead"; generation: number }
  | { type: "readProgress"; generation: number; progress: ReadProgress }
  | { type: "readDone"; generation: number; read: HevyRead }
  | { type: "readFailed"; generation: number; failure: ReadFailure }
  | { type: "cancel" }
  | { type: "goto"; step: Step; needs?: PairingNeed[]; cards?: PairingCard[] }
  | { type: "picks"; picks: PickState }
  | { type: "markersSkip" }
  | { type: "namesCards"; cards: PairingCard[] }
  | { type: "namesValidity"; valid: boolean; decisions: PairingDecision[] }
  | { type: "namesSaving" }
  | { type: "namesProgress"; created: number; total: number }
  | { type: "namesSaved"; created: number }
  | { type: "namesFailed"; message: string }
  | { type: "checkStart"; generation: number; mapping: unknown; unreadable: string[] }
  | { type: "checkProgress"; generation: number; done: number; total: number }
  | { type: "checked"; generation: number; results: HevyImportResult[] }
  | { type: "checkFailed"; generation: number; failure: CheckFailure }
  | { type: "recheck" }
  | { type: "back"; to: Step }
  | { type: "runStart"; generation: number; total: number; batchDate: string | null }
  | { type: "batchDone"; generation: number; results: HevyImportResult[]; nextDate: string | null }
  | { type: "runPaused"; generation: number; reason: PauseReason }
  | { type: "runStopped"; generation: number; reason: StopReason }
  | { type: "runEnded"; generation: number; finish: boolean }
  | { type: "resume"; generation: number }
  | { type: "routinesStart"; total: number }
  | { type: "routinesProgress"; done: number; total: number }
  | { type: "routinesDone"; outcomes: RoutineOutcome[] }
  | { type: "finishStart" }
  | { type: "finishDone"; ok: boolean }
  | { type: "toDone" };

/** Actions that open a new generation, so they are never ignored as stale. */
const OPENS_GENERATION = new Set<ImportAction["type"]>(["start", "retryRead", "checkStart", "runStart", "resume"]);

/** Entering checking always starts a fresh dry run: an earlier summary's results would stop it from running. */
const entering = (state: ImportState, step: Step): ImportState =>
  step === "checking" ? { ...state, step, results: null, summaryError: null, checkProgress: null } : { ...state, step };

export function importSession(state: ImportState, action: ImportAction): ImportState {
  if ("generation" in action && !OPENS_GENERATION.has(action.type) && action.generation !== state.generation) {
    return state;
  }
  switch (action.type) {
    case "start":
      return { ...initialImportState, step: "reading", generation: action.generation };
    case "retryRead":
      return { ...state, step: "reading", generation: action.generation, readError: null, progress: null };
    case "readProgress":
      return { ...state, progress: action.progress };
    case "readDone":
      return nextStepAfterRead({ ...state, read: action.read, readError: null, progress: null });
    case "readFailed":
      return { ...state, readError: action.failure };
    case "cancel":
      return { ...initialImportState, generation: state.generation + 1 };
    case "goto":
      return {
        ...entering(state, action.step),
        ...(action.needs ? { needs: action.needs } : {}),
        ...(action.cards ? { cards: action.cards, decisions: null, namesError: null } : {}),
      };
    case "picks":
      return { ...state, picks: action.picks };
    case "markersSkip":
      return { ...state, markersSkipped: true, step: "preparing" };
    case "namesCards":
      return { ...state, cards: action.cards };
    case "namesValidity":
      return { ...state, decisions: action.valid ? action.decisions : null };
    case "namesSaving":
      return { ...state, step: "saving_names", namesError: null, namesProgress: null };
    case "namesProgress":
      return { ...state, namesProgress: { created: action.created, total: action.total } };
    case "namesSaved":
      return { ...entering(state, "checking"), namesProgress: null, exercisesCreated: action.created };
    case "namesFailed":
      return { ...state, step: "names", namesError: action.message, namesProgress: null };
    case "checkStart":
      return {
        ...state,
        step: "checking",
        generation: action.generation,
        summaryMapping: action.mapping,
        unreadable: action.unreadable,
        results: null,
        summaryError: null,
        checkProgress: null,
      };
    case "checkProgress":
      return { ...state, checkProgress: { done: action.done, total: action.total } };
    case "checked":
      return { ...state, step: "summary", results: action.results, checkProgress: null };
    case "checkFailed":
      return { ...state, summaryError: action.failure, checkProgress: null };
    case "recheck":
      return entering(state, "checking");
    case "back":
      return { ...state, step: action.to, namesError: null, summaryError: null };
    case "runStart":
      return {
        ...state,
        step: "running",
        generation: action.generation,
        run: { sent: 0, total: action.total, batchDate: action.batchDate, batchesDone: 0, results: [], pause: null, stopReason: null },
      };
    case "batchDone": {
      if (state.run === null) return state;
      const run = state.run;
      return {
        ...state,
        run: { ...run, sent: run.sent + action.results.length, batchesDone: run.batchesDone + 1, batchDate: action.nextDate, results: [...run.results, ...action.results] },
      };
    }
    case "runPaused":
      return state.run === null ? state : { ...state, step: "paused", run: { ...state.run, pause: action.reason } };
    case "runStopped":
      return state.run === null ? state : { ...state, step: "stopped", run: { ...state.run, stopReason: action.reason } };
    case "runEnded":
      return action.finish ? { ...state, step: "finishing", finish: "running" } : { ...state, step: "done" };
    case "finishStart":
      // A Try again on the done screen keeps it; otherwise the finish is its own step.
      return { ...state, step: state.step === "done" ? "done" : "finishing", finish: "running" };
    case "finishDone":
      return { ...state, finish: action.ok ? "ok" : "failed" };
    case "toDone":
      return { ...state, step: "done", routineProgress: null };
    case "resume":
      return state.run === null ? state : { ...state, step: "running", generation: action.generation, run: { ...state.run, pause: null, stopReason: null } };
    case "routinesStart":
      return { ...state, step: "routines_run", routineProgress: { done: 0, total: action.total } };
    case "routinesProgress":
      return { ...state, routineProgress: { done: action.done, total: action.total } };
    case "routinesDone":
      return { ...state, step: "done", routineResults: action.outcomes, routineProgress: null };
  }
}

/** AC7: the routines step when Hevy has routines; otherwise the flow goes on as after it. */
export function nextStepAfterRead(state: ImportState): ImportState {
  return { ...state, step: state.read !== null && state.read.routines.length > 0 ? "routines" : "preparing" };
}

export interface FlowContext {
  mapping: HevyMapping;
  catalog: { visible: readonly Exercise[]; synced: boolean };
}

export function pickedRoutines(state: ImportState) {
  return state.read === null ? [] : state.read.routines.filter((r) => state.picks.picked.has(r.id));
}

/** The needs for the names step, counting the picked routines (AC9). */
export function needsFor(state: ImportState, ctx: FlowContext): PairingNeed[] {
  if (state.read === null) return [];
  return pairingNeeds(templatesUsed(state.read, pickedRoutines(state)), state.read.templates, ctx.mapping, ctx.catalog);
}

/** AC8 / AC9: markers (unless skipped), then names when any are needed, else straight to checking. */
export function nextStepAfterRoutines(state: ImportState, ctx: FlowContext): "markers" | "names" | "checking" {
  if (state.read === null) return "checking";
  const used = templatesUsed(state.read, pickedRoutines(state));
  const missing = markersMissing(used, state.read.templates, ctx.mapping);
  if (!state.markersSkipped && (missing.warmup !== null || missing.workout !== null)) return "markers";
  return needsFor(state, ctx).length > 0 ? "names" : "checking";
}

/** AC28 (Phase A form): the summary was computed against a different mapping than the one held now. */
export function isSummaryStale(state: ImportState, mappingData: unknown): boolean {
  return state.results !== null && state.summaryMapping !== mappingData;
}

/**
 * AC14: the earlier step Back returns to from the summary or a failed check. The routines keep their ticks; the names
 * are never shown again as they were (a saved New card's name now belongs to its exercise), so they are worked out
 * again from the mapping in `preparing`.
 */
export function backFromSummary(state: ImportState): Step {
  if (state.read !== null && state.read.routines.length > 0) return "routines";
  if (state.needs.length > 0) return "preparing";
  return "preflight";
}
