import { useEffect } from "react";

import { wakeLockSupported } from "../../ui/keepAwake";

/**
 * #108: while `enabled`, hold a screen wake lock so the phone does not sleep mid-set. The browser drops the lock
 * whenever the page is hidden (another app, the lock button), so it is asked for again each time the page comes
 * back into view. A refusal (low-power mode, an older browser) is quiet: the screen simply sleeps as usual.
 */
export function useKeepScreenAwake(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !wakeLockSupported()) return;
    let sentinel: WakeLockSentinel | null = null;
    let requesting = false;
    let done = false;

    const acquire = async () => {
      if (document.visibilityState !== "visible" || requesting || (sentinel && !sentinel.released)) return;
      requesting = true;
      try {
        const granted = await navigator.wakeLock.request("screen");
        if (done) void granted.release().catch(() => {});
        else sentinel = granted;
      } catch {
        // Refused: nothing to hold.
      } finally {
        requesting = false;
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      done = true;
      document.removeEventListener("visibilitychange", acquire);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
    };
  }, [enabled]);
}
