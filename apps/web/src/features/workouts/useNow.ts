import { useEffect, useState } from "react";

/**
 * Spec 17.1 §6.10 / AC43: the shared tick for the clock, the rest readout and the rest line (AC49: only those three
 * call it). Ticks carry no state; they only re-render, and the caller derives everything from the returned `now()`.
 * The interval runs only while `active` and the page is visible; becoming visible re-renders at once, so a phone
 * unlocked after a minute shows the right time immediately.
 */
export function useNow(intervalMs: number, active: boolean, now: () => number = Date.now): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const bump = () => setTick((n) => n + 1);
    const start = () => {
      if (id === null && document.visibilityState !== "hidden") id = setInterval(bump, intervalMs);
    };
    const stop = () => {
      if (id !== null) clearInterval(id);
      id = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        bump();
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, intervalMs]);
  return now();
}
