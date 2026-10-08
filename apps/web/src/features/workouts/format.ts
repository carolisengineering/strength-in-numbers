import type { Modality, SetEntry, SetType } from "@sin/core";

// One pinned formatter so tests and CI are locale-independent (06.0 AC6's reasoning).
const NUMBER = new Intl.NumberFormat("en", { maximumFractionDigits: 3 });

// Pinned locale + UTC so a date is the one the server stored (`localDate`), whatever the device says.
const LOCAL_DATE = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** `"2026-10-06"` → `"Tue 6 Oct"`. Shared by the summary and the History rows (Spec 08.0 AC11). */
export function formatLocalDate(localDate: string): string {
  return LOCAL_DATE.format(new Date(`${localDate}T00:00:00Z`));
}

/** Labels for the Set-type select and the tag on a logged row. */
export const SET_TYPE_LABELS: Record<SetType, string> = {
  working: "Working",
  warmup: "Warm-up",
  drop: "Drop",
  failure: "Failure",
};

/**
 * "HH:MM", 24-hour. `hourCycle: "h23"`, not `hour12: false`: the latter resolves to h24 in some ICU
 * builds and prints "24:05" at five past midnight. `timeZone` exists so tests are machine-independent.
 */
export function formatStartedTime(iso: string, { timeZone }: { timeZone?: string } = {}): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

const orDash = (value: number | null, render: (n: number) => string): string =>
  value === null ? "–" : render(value);

const withUnit = (value: number | null, unit: string | null): string =>
  orDash(value, (n) => `${NUMBER.format(n)} ${unit ?? ""}`.trim());

export function formatSet(set: SetEntry, modality: Modality): string {
  const reps = orDash(set.reps, String);
  let core: string;
  switch (modality) {
    case "weight_reps":
      core = `${withUnit(set.weight, set.weightUnit)} × ${reps}`;
      break;
    case "bodyweight_reps":
      core = set.reps === null ? "–" : `${set.reps} reps`;
      break;
    case "weighted_bodyweight":
      core = `${set.weight === null ? "–" : `+${withUnit(set.weight, set.weightUnit)}`} × ${reps}`;
      break;
    case "duration":
      core = orDash(set.durationS, formatDuration);
      break;
    case "distance_duration":
      core = `${withUnit(set.distance, set.distanceUnit)} · ${orDash(set.durationS, formatDuration)}`;
      break;
  }
  const rpe = set.rpe === null ? "" : ` @${NUMBER.format(set.rpe)}`;
  const tag = set.setType === "working" ? "" : ` (${SET_TYPE_LABELS[set.setType]})`;
  return `${core}${rpe}${tag}`;
}
