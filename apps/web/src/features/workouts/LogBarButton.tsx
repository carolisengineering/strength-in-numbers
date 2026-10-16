import { useContext, useRef } from "react";

import { Button } from "../../ui/Button";
import { DOUBLE_TAP_MS, LogActionContext, useLogAction } from "./logAction";

/**
 * Spec 17.1 §6.6, D11: the bar's one persistent button. It reads the current panel's action from the `logAction`
 * store, so it is never remounted when current advances and keeps focus (AC29). Busy is `aria-busy`, never
 * `disabled` (a disabled button drops focus). The double-tap window also spans a panel swap: a second tap within
 * 600 ms that would land on a different panel is the same tap.
 */
export function LogBarButton() {
  const action = useLogAction(useContext(LogActionContext));
  const last = useRef<{ at: number; owner: symbol } | null>(null);

  function onClick() {
    if (action === null) return;
    const now = Date.now();
    const previous = last.current;
    if (previous !== null && previous.owner !== action.owner && now - previous.at < DOUBLE_TAP_MS) return;
    last.current = { at: now, owner: action.owner };
    action.run();
  }

  return (
    <Button block disabled={action === null || action.disabled} aria-label={action?.ariaLabel} aria-busy={action?.busy || undefined} onClick={onClick}>
      {action?.label ?? "Log set"}
    </Button>
  );
}
