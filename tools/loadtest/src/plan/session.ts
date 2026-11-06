import { REST_MAX_S, REST_MIN_S } from "./constants.ts";
import { createRng } from "./rng.ts";

/**
 * Spec 16 AC2, AC3, AC13 — one lifter's session as an ordered plan: open the app, start from the routine, each
 * planned set followed by a real-pace rest, finish, then a History and a Progress read.
 */

/** The reads the web app makes when it opens (checked against the API routes, plan Task 3). */
export const OPEN_APP_READS = [
  "me",
  "exercises",
  "muscle_groups",
  "equipment",
  "routines",
  "workout_active",
  "personal_records",
] as const;
export type ReadName = (typeof OPEN_APP_READS)[number];

export type Action =
  | { kind: "read"; name: ReadName }
  | { kind: "start" }
  | { kind: "set"; itemIndex: number; setIndex: number }
  | { kind: "rest"; seconds: number }
  | { kind: "finish" }
  | { kind: "history" }
  | { kind: "progress"; itemIndex: number };

export interface Session {
  actions: Action[];
  pushFactor: number;
}

/** Uniform in [90, 180] s at real pace; push mode divides every rest by its factor (AC3). */
export function restSeconds(rng: () => number, pushFactor: number): number {
  return (REST_MIN_S + rng() * (REST_MAX_S - REST_MIN_S)) / pushFactor;
}

/** `sets[i]` is routine item i's planned set count. */
export function buildSession(opts: { seed: number; sets: number[]; pushFactor: number }): Session {
  const rng = createRng(opts.seed);
  const actions: Action[] = OPEN_APP_READS.map((name) => ({ kind: "read", name }));
  actions.push({ kind: "start" });
  const total = opts.sets.reduce((n, s) => n + s, 0);
  let done = 0;
  opts.sets.forEach((count, itemIndex) => {
    for (let setIndex = 0; setIndex < count; setIndex += 1) {
      actions.push({ kind: "set", itemIndex, setIndex });
      done += 1;
      if (done < total) actions.push({ kind: "rest", seconds: restSeconds(rng, opts.pushFactor) });
    }
  });
  actions.push({ kind: "finish" }, { kind: "history" }, { kind: "progress", itemIndex: Math.floor(rng() * opts.sets.length) });
  return { actions, pushFactor: opts.pushFactor };
}

export interface Join {
  startIndex: number;
  /** True when the join point is inside the workout (after `start`, before `finish`): send `start` first. */
  needsStart: boolean;
}

/** A lifter joins its first session at a random point, so every step carries the full mix (AC13). */
export function joinAt(actions: Action[], rng: () => number): Join {
  const startIndex = Math.min(actions.length - 1, Math.floor(rng() * actions.length));
  const startPos = actions.findIndex((a) => a.kind === "start");
  const finishPos = actions.findIndex((a) => a.kind === "finish");
  return { startIndex, needsStart: startIndex > startPos && startIndex < finishPos };
}

/**
 * The first session's actions for a lifter that joined part-way. Inside the workout it starts one first; at or
 * after `finish` there is no workout, so the finish is skipped (Review Focus 5).
 */
export function joinedActions(actions: Action[], join: Join): Action[] {
  const rest = actions.slice(join.startIndex);
  if (join.needsStart) return [{ kind: "start" }, ...rest];
  const finishPos = actions.findIndex((a) => a.kind === "finish");
  return join.startIndex >= finishPos ? rest.filter((a) => a.kind !== "finish") : rest;
}

/** A `409` on start means a live workout is already there (a leftover): adopt it (Review Focus 1). */
export function nextActionOnStartConflict(status: number): "adopt_active" | "record_failure" {
  return status === 409 ? "adopt_active" : "record_failure";
}
