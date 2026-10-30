import { RoutineWriteSchema, type CodeCount, type HevyRoutine, type HevyRoutineNoticeCode, type HevyRoutineTranslation, type RoutineWrite } from "@sin/core";

import { ApiError } from "../../../api";
import { reportError } from "../../../observability/reportError";
import { ROUTINE_GAP_MS } from "./constants";
import { reportable } from "./reportable";

/**
 * Spec 20.1 AC23, §6.9: the routines Carol ticked, created after the finish, one at a time and no more than 20 a
 * minute. A `routine-limit` ends the step (the cap can't clear mid-run, D12); any other failure is that routine's
 * and the next one is still tried. Nothing here touches the workouts. React-free.
 */

export type RoutineOutcomeKind = "created" | "exists" | "limit_not_created" | "unpaired" | "no_items" | "invalid" | "failed";
export interface RoutineOutcome {
  hevyRoutineId: string;
  /** Hevy's title, shown and reported as text. */
  name: string;
  kind: RoutineOutcomeKind;
  notices: CodeCount<HevyRoutineNoticeCode>[];
}

export interface CreateRoutinesDeps {
  create(body: RoutineWrite): Promise<unknown>;
  translate(routine: HevyRoutine): HevyRoutineTranslation;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** Aborted on unmount: no further routine is sent. */
  signal: AbortSignal;
  onProgress(done: number, total: number): void;
}

const slug = (err: unknown) => (err instanceof ApiError ? err.type : null);

function failureKind(err: unknown): RoutineOutcomeKind {
  if (err instanceof ApiError && err.status === 409 && err.type === "routine-name-taken") return "exists";
  if (err instanceof ApiError && err.status === 422) return "invalid";
  if (reportable(err)) reportError(err, { source: "hevy-import", op: "routine" });
  return "failed";
}

/** A routine after the limit: its own reason when it couldn't be created anyway, else `limit_not_created`. */
function unsentOutcome(routine: HevyRoutine, translated: HevyRoutineTranslation): RoutineOutcome {
  const base = { hevyRoutineId: routine.id, name: routine.title };
  if (!translated.ok) return { ...base, kind: translated.reason, notices: [] };
  const kind = RoutineWriteSchema.safeParse(translated.input).success ? "limit_not_created" : "invalid";
  return { ...base, kind, notices: translated.notices };
}

export async function createRoutines(routines: readonly HevyRoutine[], deps: CreateRoutinesDeps): Promise<RoutineOutcome[]> {
  const outcomes: RoutineOutcome[] = [];
  let sentBefore = false;
  for (const [index, routine] of routines.entries()) {
    if (deps.signal.aborted) break;
    const base = { hevyRoutineId: routine.id, name: routine.title };
    const translated = deps.translate(routine);
    if (!translated.ok) {
      outcomes.push({ ...base, kind: translated.reason, notices: [] });
    } else {
      const notices = translated.notices;
      // §6.9: the schema is the last check before the request.
      const body = RoutineWriteSchema.safeParse(translated.input);
      if (!body.success) {
        outcomes.push({ ...base, kind: "invalid", notices });
      } else {
        if (sentBefore) {
          try {
            await deps.sleep(ROUTINE_GAP_MS, deps.signal);
          } catch {
            break;
          }
        }
        sentBefore = true;
        try {
          await deps.create(body.data);
          outcomes.push({ ...base, kind: "created", notices });
        } catch (err) {
          if (err instanceof ApiError && err.status === 409 && slug(err) === "routine-limit") {
            // D12: the cap can't clear mid-run, so nothing more is sent. A later routine that couldn't be created
            // anyway (nothing to import, unpaired, invalid) keeps its own reason; only the sendable ones are "limit".
            outcomes.push({ ...base, kind: "limit_not_created", notices });
            for (const rest of routines.slice(index + 1)) outcomes.push(unsentOutcome(rest, deps.translate(rest)));
            deps.onProgress(routines.length, routines.length);
            return outcomes;
          }
          outcomes.push({ ...base, kind: failureKind(err), notices });
        }
      }
    }
    deps.onProgress(outcomes.length, routines.length);
  }
  return outcomes;
}
