import { HevyError } from "./hevyErrors";

/**
 * Spec 20.0 AC10: one pacer for every Hevy request on this device. Requests start at least `HEVY_MIN_GAP_MS` apart,
 * never in the first minute of a UTC hour (Hevy's maintenance window), and never before a `Retry-After` instant.
 * `wait` reserves its slot synchronously, so concurrent callers queue in call order. React-free; the clock and
 * `sleep` are injected.
 */

export const HEVY_MIN_GAP_MS = 600;
/** AC11: the waits before each retry of a `GET` (writes are never retried). */
export const HEVY_GET_RETRY_WAITS_MS = [1000, 2000, 4000] as const;

const HOUR_MS = 3_600_000;
const QUIET_MS = 60_000;

export interface Pacer {
  /** Resolves when the next request may start; rejects with an `aborted` HevyError when the signal aborts. */
  wait(signal?: AbortSignal): Promise<void>;
  /** No request starts before `atMs` (a `Retry-After`). */
  deferUntil(atMs: number): void;
}

export interface PacerDeps {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** The slot moved out of the first minute of its UTC hour. */
function outOfQuietMinute(slotMs: number): number {
  const intoHour = ((slotMs % HOUR_MS) + HOUR_MS) % HOUR_MS;
  return intoHour < QUIET_MS ? slotMs - intoHour + QUIET_MS : slotMs;
}

export function createPacer(deps: PacerDeps): Pacer {
  let nextSlotMs = Number.NEGATIVE_INFINITY;
  let deferredUntilMs = Number.NEGATIVE_INFINITY;

  return {
    async wait(signal) {
      if (signal?.aborted) throw new HevyError("aborted");
      let slot = outOfQuietMinute(Math.max(nextSlotMs, deferredUntilMs, deps.now()));
      nextSlotMs = slot + HEVY_MIN_GAP_MS;
      for (;;) {
        const ms = slot - deps.now();
        try {
          if (ms > 0) await deps.sleep(ms, signal);
        } catch {
          throw new HevyError("aborted");
        }
        if (signal?.aborted) throw new HevyError("aborted");
        // A Retry-After that arrived while this caller slept still holds it back.
        const later = outOfQuietMinute(Math.max(slot, deferredUntilMs));
        if (later <= slot) return;
        slot = later;
        nextSlotMs = Math.max(nextSlotMs, slot + HEVY_MIN_GAP_MS);
      }
    },
    deferUntil(atMs) {
      deferredUntilMs = Math.max(deferredUntilMs, atMs);
    },
  };
}
