import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * The element's content width in whole CSS px, followed through a `ResizeObserver` (Spec 17.12 AC23).
 * `fallback` where the browser has none (jsdom), and the last good width when the element measures 0
 * (being laid out, or `display: none`), so a caller never draws at a width of 0 or NaN.
 */
export function useMeasuredWidth(ref: RefObject<Element | null>, fallback = 360): number {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const take = (raw: number) => {
      const measured = Math.floor(raw);
      if (measured > 0) setWidth(measured);
    };
    // Read once now: a set state in a layout effect renders before paint, while the observer's first callback lands a
    // frame later, so a wide chart would first paint at the fallback width (final review).
    take(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => take(entries[0]?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
