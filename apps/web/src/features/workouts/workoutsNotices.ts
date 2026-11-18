import { createContext, useContext, useMemo, useState, type Dispatch, type SetStateAction } from "react";

/** The Workouts screen's one-line notice and the workout a write reported gone (Spec 06.1 §5.8). */
export interface WorkoutsNotices {
  readonly notice: string | null;
  readonly setNotice: Dispatch<SetStateAction<string | null>>;
  readonly goneId: string | null;
  readonly setGoneId: Dispatch<SetStateAction<string | null>>;
}

/**
 * Spec 17.12 AC26 (code review): at desktop widths `/app/workouts` moves between the detail slot (a live workout's
 * single column) and the list pane (Start beside "Choose a routine"), which mounts a new `WorkoutsScreen`. The routines
 * layout holds the notices there, so "That workout was already finished or removed." survives the move. `null` (a
 * phone, or no layout) keeps them in the screen's own state, as before.
 */
export const WorkoutsNoticesContext = createContext<WorkoutsNotices | null>(null);

/** The layout's store: always created, and handed to the context only at desktop widths. */
export function useWorkoutsNoticesStore(): WorkoutsNotices {
  const [notice, setNotice] = useState<string | null>(null);
  const [goneId, setGoneId] = useState<string | null>(null);
  return useMemo(() => ({ notice, setNotice, goneId, setGoneId }), [notice, goneId]);
}

/** The layout's notices when it shares them, else this screen's own (seeded from `initialNotice`). */
export function useWorkoutsNotices(initialNotice: () => string | null): WorkoutsNotices {
  const shared = useContext(WorkoutsNoticesContext);
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [goneId, setGoneId] = useState<string | null>(null);
  return shared ?? { notice, setNotice, goneId, setGoneId };
}
