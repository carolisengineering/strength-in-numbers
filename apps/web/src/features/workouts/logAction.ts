import { createContext, useSyncExternalStore } from "react";
import type { Modality } from "@sin/core";

import { formatWeight } from "../routines/targetFormat";
import { formatDuration } from "./format";
import { parseDraft, type SetDraft } from "./setDraft";

/**
 * Spec 17.1 §6.6: the bar button's visible text. Mirrors `formatSet`'s core: the weight unit is appended only when it
 * differs from the profile's; a distance always carries its unit. "Log set" while the draft does not parse.
 */
export function logLabel(modality: Modality, draft: SetDraft, unitPreference: "kg" | "lb"): string {
  const parsed = parseDraft(modality, draft);
  if (!parsed.ok) return "Log set";
  const body = parsed.body;
  const unit = body.weightUnit !== undefined && body.weightUnit !== unitPreference ? ` ${body.weightUnit}` : "";
  const weight = body.weight === undefined || body.weight === null ? "" : `${formatWeight(body.weight)}${unit}`;
  const reps = body.reps ?? 0;
  const duration = formatDuration(body.durationS ?? 0);
  switch (modality) {
    case "weight_reps":
      return `Log ${weight} × ${reps}`;
    case "weighted_bodyweight":
      return `Log +${weight} × ${reps}`;
    case "bodyweight_reps":
      return `Log ${reps} ${reps === 1 ? "rep" : "reps"}`;
    case "duration":
      return `Log ${duration}`;
    case "distance_duration":
      return `Log ${String(body.distance ?? 0)} ${body.distanceUnit ?? ""} · ${duration}`;
    // Spec 05.3 Phase A: plain fallbacks; the UI spec (18.1) owns the new types' entry.
    case "calories":
      return `Log ${String(body.calories ?? 0)} cal`;
    case "weight_distance":
      return `Log ${weight} · ${String(body.distance ?? 0)} ${body.distanceUnit ?? ""}`;
    case "weight_duration":
      return `Log ${weight} · ${duration}`;
  }
}

/** A same-values tap within this window, with nothing typed in between, is the same tap (Spec 06.2, 17.1). */
export const DOUBLE_TAP_MS = 600;

/** What the current panel offers the bar (Spec 17.1 §6.5–§6.6). `owner` is the publishing panel. */
export interface LogAction {
  readonly owner: symbol;
  readonly label: string;
  readonly ariaLabel: string;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly run: () => void;
}

export interface LogActionStore {
  publish(action: LogAction): void;
  /** Clears the action only if `owner` published it: an unmounting panel never clears its successor's. */
  withdraw(owner: symbol): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): LogAction | null;
}

/**
 * D11: a value plus `subscribe`, read with `useSyncExternalStore`, so a ± tap re-renders the panel and the bar button
 * only, never the card list. One store per `ActiveSession`.
 */
export function createLogActionStore(): LogActionStore {
  let current: LogAction | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    publish(action) {
      current = action;
      emit();
    },
    withdraw(owner) {
      if (current?.owner !== owner) return;
      current = null;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => current,
  };
}

export const LogActionContext = createContext<LogActionStore | null>(null);

const NO_SUBSCRIBE = () => () => {};
const NO_SNAPSHOT = () => null;

export function useLogAction(store: LogActionStore | null): LogAction | null {
  return useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, store?.getSnapshot ?? NO_SNAPSHOT);
}
