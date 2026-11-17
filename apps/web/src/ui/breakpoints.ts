import { useSyncExternalStore } from "react";

/**
 * Spec 17.12 AC1: the one `matchMedia` string for the desktop layout. It repeats `--bp-desktop` (`tokens.css`) as a
 * literal, because a custom property can't be read inside a media condition; `breakpoints.test.ts` keeps them equal.
 */
export const DESKTOP_QUERY = "(min-width: 64rem)";

/** The desktop query's list, looked up per call (never cached at module load), or `null` where there is no `matchMedia`. */
function desktopList(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(DESKTOP_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const list = desktopList();
  if (!list) return () => {};
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

const getSnapshot = (): boolean => desktopList()?.matches ?? false;

/**
 * Spec 17.12 AC2: whether the window is at the desktop width (64rem and wider). Read through `useSyncExternalStore`,
 * so the first render already has the answer (no flash of the phone layout) and a resize across 64rem re-renders.
 * False where there is no `matchMedia` (jsdom), so tests run the phone layout unless they call `setDesktop`.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
