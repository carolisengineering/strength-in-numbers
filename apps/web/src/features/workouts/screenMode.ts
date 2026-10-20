import { createContext, useContext } from "react";

/** What an edit-mode control tells the screen after a write (Spec 18.0 §5.4): the screen owns banners and the status line. */
export type EditOutcome =
  | { readonly type: "saved"; readonly announcement: string }
  | { readonly type: "last-set" }
  | { readonly type: "missing"; readonly text: string }
  | { readonly type: "vanished" };

export interface EditScreenMode {
  readonly kind: "edit";
  readonly workoutId: string;
  readonly report: (outcome: EditOutcome) => void;
}

/**
 * Spec 18.0 D3: the one seam where a shared leaf (`ExerciseCard`, `SetEditSheet`) learns it is on the edit screen.
 * `live` by default, so the logging screen provides nothing and is unchanged.
 */
export type ScreenMode = { readonly kind: "live" } | EditScreenMode;

export const ScreenModeContext = createContext<ScreenMode>({ kind: "live" });

export function useScreenMode(): ScreenMode {
  return useContext(ScreenModeContext);
}
