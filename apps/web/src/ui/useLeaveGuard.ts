import { useEffect, useRef } from "react";
import { useBlocker } from "react-router";

/**
 * The one leave guard (minor 255): the routine editor's unsaved draft (Spec 10.0 AC34) and the Hevy import's run
 * (Spec 20.1 AC20). While `active`, a route change to another path asks first (the data router's blocker) and a
 * reload or tab close gets the browser's own prompt, through a `beforeunload` listener installed only while `active`.
 *
 * `confirm` runs `onConfirm`, disarms the guard and lets the navigation go on; `cancel` stays. A disarmed guard asks
 * no more until the screen unmounts: the router reaches the next screen before this one unmounts, and a Back in that
 * gap must not be asked again. `disarm` is for a screen that leaves on its own (a save that navigates).
 */
export function useLeaveGuard(active: boolean, onConfirm?: () => void) {
  const disarmed = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => active && !disarmed.current && currentLocation.pathname !== nextLocation.pathname);

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
      onConfirm?.();
      disarmed.current = true;
      blocker.proceed?.();
    },
    cancel: () => blocker.reset?.(),
    disarm: () => {
      disarmed.current = true;
    },
  };
}
