import { useEffect, useRef, useState } from "react";

/**
 * Spec 17.6 AC11's Show all / Show fewer, shared by the ledger and the first-time lines. Expanded is local and never
 * stored, and the button keeps focus both ways (the disclosure pattern). Collapsing shrinks the list above the button,
 * which can leave it off-screen on a phone (minor 474), so Show fewer scrolls it back into view (`block: "nearest"`:
 * no movement when it is already visible).
 */
export function useCollapseToggle() {
  const [expanded, setExpanded] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const collapsedByTap = useRef(false);
  useEffect(() => {
    if (expanded || !collapsedByTap.current) return;
    collapsedByTap.current = false;
    buttonRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [expanded]);
  const toggle = () => {
    collapsedByTap.current = expanded;
    setExpanded(!expanded);
  };
  return { expanded, toggle, buttonRef };
}
