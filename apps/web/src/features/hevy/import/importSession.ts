import type { Exercise, HevyImportResult, HevyMapping } from "@sin/core";

import type { PairingCard, PairingDecision, PairingNeed } from "../pairing";
import { markersMissing, pairingNeeds, templatesUsed } from "./importNeeds";
import type { HevyRead, ReadProgress, ReadStage } from "./readHevy";
import type { PickState } from "./routinePicks";

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
  | "summary";

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
  | { type: "back"; to: Step };

/** Entering checking always starts a fresh dry run: an earlier summary's results would stop it from running. */
const entering = (state: ImportState, step: Step): ImportState =>
  step === "checking" ? { ...state, step, results: null, summaryError: null, checkProgress: null } : { ...state, step };

export function importSession(state: ImportState, action: ImportAction): ImportState {
  if ("generation" in action && action.type !== "start" && action.type !== "retryRead" && action.type !== "checkStart" && action.generation !== state.generation) {
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

/** AC14: the earlier step Back returns to from the summary or a failed check. */
export function backFromSummary(state: ImportState): Step {
  if (state.needs.length > 0) return "names";
  if (state.read !== null && state.read.routines.length > 0) return "routines";
  return "preflight";
}
