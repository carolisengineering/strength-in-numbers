import { useIsDesktop } from "./breakpoints";

/**
 * Spec 17.12 §6.4: the selected id of a list-and-detail screen. The route's id when there is one (even if it isn't in
 * the loaded list: an old link, a page not loaded yet); else, at desktop widths, the first id of the list (the newest
 * workout), so the detail pane is never blank while there is something to show; on a phone, nothing.
 */
export function selectedId(routeId: string | null, ids: readonly string[], wide: boolean): string | null {
  if (routeId !== null) return routeId;
  return wide ? (ids[0] ?? null) : null;
}

/** `selectedId` at the window's width. */
export function useSelectedId(routeId: string | null, ids: readonly string[]): string | null {
  return selectedId(routeId, ids, useIsDesktop());
}
