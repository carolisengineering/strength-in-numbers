import { DESKTOP_QUERY } from "../ui/breakpoints";

/**
 * Spec 17.12: wide-width tests. jsdom has no `window.matchMedia`, so every test runs the phone layout by default.
 * `setDesktop(wide)` installs (once) a fake whose `MediaQueryList` for `DESKTOP_QUERY` reports `matches === wide`, and
 * fires `change` to its listeners when a later call flips it (wrap a flip after render in `act`). Any other query
 * never matches. `resetDesktop()` removes the fake again; call it in `afterEach`.
 */

type Listener = (event: MediaQueryListEvent) => void;

let wide = false;
const listeners = new Set<Listener>();

function mediaQueryList(query: string): MediaQueryList {
  const desktop = query === DESKTOP_QUERY;
  const list = {
    get matches() {
      return desktop && wide;
    },
    media: query,
    onchange: null,
    addEventListener(_type: string, listener: Listener) {
      if (desktop) listeners.add(listener);
    },
    removeEventListener(_type: string, listener: Listener) {
      listeners.delete(listener);
    },
    addListener(listener: Listener) {
      if (desktop) listeners.add(listener);
    },
    removeListener(listener: Listener) {
      listeners.delete(listener);
    },
    dispatchEvent: () => false,
  };
  return list as unknown as MediaQueryList;
}

export function setDesktop(next: boolean): void {
  if (!("matchMedia" in window)) {
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: mediaQueryList });
  }
  if (next === wide) return;
  wide = next;
  for (const listener of [...listeners]) listener({ matches: wide, media: DESKTOP_QUERY } as MediaQueryListEvent);
}

export function resetDesktop(): void {
  wide = false;
  listeners.clear();
  delete (window as { matchMedia?: unknown }).matchMedia;
}

/** How many listeners are on the desktop query now (a hook that unmounts must leave none). */
export function desktopListenerCount(): number {
  return listeners.size;
}
