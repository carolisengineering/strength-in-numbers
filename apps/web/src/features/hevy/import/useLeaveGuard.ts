import { useEffect } from "react";
import { useBlocker } from "react-router";

/**
 * Spec 20.1 AC20: while the import is writing, a route change asks first (the data router's blocker, as
 * `RoutineEditor`) and a reload or tab close gets the browser's own prompt, through a `beforeunload` listener that is
 * installed only while `active`. Confirming calls `onConfirm` (stop after the batch in flight; the request itself is
 * never aborted) and lets the navigation go on; Cancel keeps the run going.
 */
export function useLeaveGuard(active: boolean, onConfirm: () => void) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => active && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  return {
    open: blocker.state === "blocked",
    confirm: () => {
      onConfirm();
      blocker.proceed?.();
    },
    cancel: () => blocker.reset?.(),
  };
}
