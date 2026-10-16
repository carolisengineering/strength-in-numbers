import { useContext, useEffect, useRef } from "react";

import { Button } from "../../ui/Button";
import { DOUBLE_TAP_MS, LogActionContext, useLogAction } from "./logAction";

/**
 * Spec 17.1 §6.6, D11: the bar's one persistent button. It reads the current panel's action from the `logAction`
 * store, so it is never remounted when current advances and keeps focus (AC29). Busy is `aria-busy` and unavailable is
 * `aria-disabled` (the click is ignored), never `disabled`: a disabled button drops focus. The double-tap window also spans a panel swap: a second tap within
 * 600 ms that would land on a different panel is the same tap.
 */
export type BarAction =
  | { readonly kind: "log" }
  | { readonly kind: "finish"; readonly disabled: boolean; readonly onClick: () => void }
  | { readonly kind: "add"; readonly disabled: boolean; readonly onClick: () => void };

/** One `Button` in every mode, so the element (and its focus) survives the switch to Finish after the last planned set. */
export function LogBarButton({ action: mode }: { action: BarAction }) {
  const action = useLogAction(useContext(LogActionContext));
  const last = useRef<{ at: number; owner: symbol } | null>(null);
  // The window covers only the advance this button's own tap caused: any other input in between (a row tapped, the
  // picker, a key in a field) is a deliberate next step, so the next tap logs however soon it comes.
  useEffect(() => {
    const reset = (event: Event) => {
      if (!(event.target instanceof Element) || event.target.closest("[data-log-bar]") === null) last.current = null;
    };
    document.addEventListener("pointerdown", reset, true);
    document.addEventListener("keydown", reset, true);
    return () => {
      document.removeEventListener("pointerdown", reset, true);
      document.removeEventListener("keydown", reset, true);
    };
  }, []);

  if (mode.kind !== "log") {
    return (
      <Button block aria-disabled={mode.disabled || undefined} onClick={mode.disabled ? undefined : mode.onClick}>
        {mode.kind === "finish" ? "Finish workout" : "Add exercise"}
      </Button>
    );
  }

  const inert = action === null || action.disabled;
  function onClick() {
    if (action === null || action.disabled) return;
    const now = Date.now();
    const previous = last.current;
    if (previous !== null && previous.owner !== action.owner && now - previous.at < DOUBLE_TAP_MS) return;
    last.current = { at: now, owner: action.owner };
    action.run();
  }

  return (
    <Button block data-log-bar="" aria-disabled={inert || undefined} aria-label={action?.ariaLabel} aria-busy={action?.busy || undefined} onClick={onClick}>
      {action?.label ?? "Log set"}
    </Button>
  );
}
