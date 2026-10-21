import {
  RETIME_MESSAGES,
  WORKOUT_DURATION_MAX_S,
  WORKOUT_START_EDIT_FLOOR,
  resolveRetime,
  type Workout,
} from "@sin/core";
import { ApiError } from "../../../api";
import { todayLocal } from "../../progress/dates";
import { EDIT_COPY } from "../edit/editCopy";
import { workoutMinutes } from "../finishStats";
import { startWorkoutFields } from "../timestamps";
import type { WorkoutUpdate } from "../workoutClient";

/**
 * Spec 18.0 §6.5, pure: the Change Time form (day, start, took) in the device zone (D10), the patch
 * holding only the changed groups (AC31), the `resolveRetime` pre-check and the §5.6 copy. The
 * server is the authority; a server `422` is shown through the same `copyFor`.
 */
export type TimedWorkout = Pick<Workout, "startedAt" | "endedAt" | "plannedDurationSeconds">;

export interface ChangeTimeForm {
  day: string;
  time: string;
  hours: string;
  minutes: string;
}

export type ChangeTimeField = "day" | "time" | "took";
export type ChangeTimeErrors = Partial<Record<ChangeTimeField | "form", string>>;

const pad = (n: number) => String(n).padStart(2, "0");
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;
const WHOLE = /^\d+$/;
const MAX_MINUTES = WORKOUT_DURATION_MAX_S / 60;

/** Took's initial minutes: the plan (live), the stored duration (finished), or none. */
function initialMinutes(w: TimedWorkout): number | null {
  if (w.endedAt !== null) return workoutMinutes(w.startedAt, w.endedAt);
  return w.plannedDurationSeconds === null ? null : Math.round(w.plannedDurationSeconds / 60);
}

export function initialValues(w: TimedWorkout): ChangeTimeForm {
  const start = new Date(w.startedAt);
  const m = initialMinutes(w);
  return {
    day: todayLocal(start),
    time: localTime(start),
    hours: m === null ? "" : String(Math.floor(m / 60)),
    minutes: m === null ? "" : String(m % 60),
  };
}

export function dayBounds(now: Date): { min: string; max: string } {
  return { min: WORKOUT_START_EDIT_FLOOR.slice(0, 10), max: todayLocal(now) };
}

/** The device-zone instant of a Day and a Started at (AC32); JS moves a spring-forward gap forward. */
export function instantFrom(day: string, time: string): Date {
  const [, y, mo, d] = DAY.exec(day)!.map(Number) as [number, number, number, number];
  const [, h, min] = TIME.exec(time)!.map(Number) as [number, number, number];
  return new Date(y, mo - 1, d, h, min);
}

/** Took as typed: `null` when both fields are blank; a blank one counts as 0; `"invalid"` when not whole numbers. */
function typedMinutes(form: ChangeTimeForm): { total: number | null; hours: number; minutes: number } | "invalid" {
  const h = form.hours.trim();
  const m = form.minutes.trim();
  if (h === "" && m === "") return { total: null, hours: 0, minutes: 0 };
  if ((h !== "" && !WHOLE.test(h)) || (m !== "" && !WHOLE.test(m))) return "invalid";
  const hours = h === "" ? 0 : Number(h);
  const minutes = m === "" ? 0 : Number(m);
  return { total: hours * 60 + minutes, hours, minutes };
}

export function buildPatch(
  w: TimedWorkout,
  form: ChangeTimeForm,
): { ok: true; patch: WorkoutUpdate | null } | { ok: false; errors: ChangeTimeErrors } {
  const initial = initialValues(w);
  const errors: ChangeTimeErrors = {};
  if (!DAY.test(form.day)) errors.day = EDIT_COPY.pickDay;
  if (!TIME.test(form.time)) errors.time = EDIT_COPY.pickTime;

  // Took is checked only when it differs from its initial value (a stored finish can exceed 24 h).
  const took = typedMinutes(form);
  const tookChanged = took === "invalid" || took.total !== initialMinutes(w);
  if (tookChanged) {
    // §5.6: anything above 24 h (hours 25 included) is "at most 24 hours"; "whole numbers" is for the rest.
    if (took === "invalid" || took.minutes > 59) errors.took = EDIT_COPY.tookWhole;
    else if (took.total !== null && took.total > MAX_MINUTES) errors.took = EDIT_COPY.tookMax;
    else if (took.total === null && w.endedAt !== null) errors.took = EDIT_COPY.tookRequired;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const patch: { -readonly [K in keyof WorkoutUpdate]: WorkoutUpdate[K] } = {};
  if (form.day !== initial.day || form.time !== initial.time) {
    const start = instantFrom(form.day, form.time);
    patch.startedAt = start.toISOString();
    patch.tzOffsetMinutes = startWorkoutFields(start).tzOffsetMinutes;
  }
  if (tookChanged && took !== "invalid") patch.durationSeconds = took.total === null ? null : took.total * 60;
  return { ok: true, patch: Object.keys(patch).length === 0 ? null : patch };
}

/** §5.6: a `RETIME_MESSAGES` value (client pre-check or server `422`) to its field and pinned copy, by message. */
export function copyFor(path: string, message: string): { field: ChangeTimeField | "form"; text: string } {
  switch (message) {
    case RETIME_MESSAGES.future:
      return { field: "time", text: EDIT_COPY.timeFuture };
    case RETIME_MESSAGES.floor:
      return { field: "day", text: EDIT_COPY.timeFloor };
    case RETIME_MESSAGES.endsInFuture:
      if (path === "startedAt") return { field: "time", text: EDIT_COPY.timeEndsInFuture };
      if (path === "durationSeconds") return { field: "took", text: EDIT_COPY.timeEndsInFuture };
      return { field: "form", text: EDIT_COPY.timeEndsInFuture };
    case RETIME_MESSAGES.finishedDurationNull:
      return { field: "took", text: EDIT_COPY.tookRequired };
    default:
      return { field: "form", text: EDIT_COPY.timeGeneric };
  }
}

/** AC33: the shared rule set on the stored workout and the patch, at `now`; `null` when it passes. */
export function validate(w: TimedWorkout, patch: WorkoutUpdate, now: Date): ChangeTimeErrors | null {
  const result = resolveRetime(
    {
      startedAt: new Date(w.startedAt),
      endedAt: w.endedAt === null ? null : new Date(w.endedAt),
      plannedDurationS: w.plannedDurationSeconds,
    },
    {
      ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
      ...(patch.durationSeconds !== undefined ? { durationSeconds: patch.durationSeconds } : {}),
    },
    now,
  );
  if (result.ok) return null;
  const { field, text } = copyFor(result.path, result.message);
  return { [field]: text };
}

export type ChangeTimeFailure =
  | { type: "vanished" }
  | { type: "fields"; errors: ChangeTimeErrors }
  | { type: "message"; text: string; requestId: string | null };

/** §5.4's Change Time row (AC41). Never reads the error's text. */
export function changeTimeFailure(error: unknown): ChangeTimeFailure {
  if (!(error instanceof ApiError)) return { type: "message", text: EDIT_COPY.changeTimeFailed, requestId: null };
  if (error.isNetworkError) return { type: "message", text: EDIT_COPY.offline, requestId: error.requestId ?? null };
  if (error.status === 404) return { type: "vanished" };
  if (error.status === 422) {
    const errors: ChangeTimeErrors = {};
    for (const e of error.errors ?? []) {
      const { field, text } = copyFor(e.path, e.message);
      errors[field] ??= text;
    }
    return { type: "fields", errors: Object.keys(errors).length === 0 ? { form: EDIT_COPY.timeGeneric } : errors };
  }
  return { type: "message", text: EDIT_COPY.changeTimeFailed, requestId: error.requestId ?? null };
}

export function changedGroups(patch: WorkoutUpdate): "start" | "duration" | "both" {
  const start = patch.startedAt !== undefined;
  const duration = patch.durationSeconds !== undefined;
  return start && duration ? "both" : start ? "start" : "duration";
}

/** Device-local calendar days from the start's date to `now`'s, never negative (AC43). */
export function daysBack(now: Date, startedAt: string): number {
  const dayNumber = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  return Math.max(0, dayNumber(now) - dayNumber(new Date(startedAt)));
}
