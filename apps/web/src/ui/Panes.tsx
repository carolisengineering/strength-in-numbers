import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Outlet, useLocation } from "react-router";

import { useIsDesktop } from "./breakpoints";
import { PaneContext, type PaneValue } from "./paneContext";
import styles from "./Panes.module.css";

export interface PanesProps {
  /** The list pane's screen, drawn only at desktop widths. */
  list: ReactNode;
  /** The list region's accessible name ("History"). */
  listLabel: string;
  /** The detail region's accessible name ("Workout"). */
  detailLabel: string;
  /** The derived selection (`useSelectedId`), handed to both panes through `PaneContext`. */
  selectedId: string | null;
}

/**
 * Spec 17.12 §6.3, AC13: a list-and-detail layout route. The detail is always the route's `<Outlet/>`, and the root's
 * children are always `[list slot, detail slot]`, so a resize across 64rem never remounts the detail. At desktop
 * widths the list and the detail are two labelled regions, each its own scroller; below 64rem there is no list and the
 * wrappers are `display: contents` with no role, so the phone draws exactly today's screen for each URL.
 */
export function Panes({ list, listLabel, detailLabel, selectedId }: PanesProps) {
  const wide = useIsDesktop();
  const { pathname } = useLocation();
  const detailRef = useRef<HTMLDivElement>(null);
  const listValue = useMemo<PaneValue>(() => ({ slot: "list", selectedId }), [selectedId]);
  const detailValue = useMemo<PaneValue>(() => ({ slot: wide ? "detail" : null, selectedId }), [wide, selectedId]);

  // AC16: opening another item starts the detail at its top; the list keeps its place. The selection too: at a list's
  // bare path the open item is derived, so a delete or a new newest changes it with no change of path.
  useLayoutEffect(() => {
    if (detailRef.current) detailRef.current.scrollTop = 0;
  }, [pathname, selectedId]);

  return (
    <div className={styles.root} data-wide={wide ? "" : undefined}>
      {wide ? (
        <PaneContext.Provider value={listValue}>
          <div className={styles.slot} role="region" aria-label={listLabel} data-pane="">
            {list}
          </div>
        </PaneContext.Provider>
      ) : null}
      <PaneContext.Provider value={detailValue}>
        <div
          ref={detailRef}
          className={styles.slot}
          role={wide ? "region" : undefined}
          aria-label={wide ? detailLabel : undefined}
          data-pane={wide ? "" : undefined}
        >
          <Outlet />
        </div>
      </PaneContext.Provider>
    </div>
  );
}
