/**
 * The app frame while an on-screen keyboard is up (#204, #206, #207).
 *
 * iPhone's keyboard does not shrink the layout viewport: it covers the bottom of it, and iOS scrolls or pans the
 * page to keep the focused field visible. So the shell's bottom bar and nav sat under the keyboard (#206). The
 * shell is `position: fixed` against the layout viewport; while a keyboard is up this module gives it the visible
 * rectangle instead, as `--app-top` / `--app-height` plus `data-keyboard="open"` on `<html>`, and the shell's
 * stylesheet does the rest. Nothing is set while the keyboard is down, so every other moment is plain CSS.
 *
 * The properties are written through the CSSOM (`style.setProperty`), which the strict `style-src 'self'` CSP
 * does not govern; no style attribute is ever parsed from markup.
 */

/** The parts of `window.visualViewport` read here. */
export interface ViewportBox {
  height: number;
  offsetTop: number;
  scale: number;
}

/** The visible rectangle, in CSS px from the layout viewport's top. */
export interface KeyboardFrame {
  top: number;
  height: number;
}

/** A keyboard covers far more than this; a browser toolbar collapsing covers less. */
const KEYBOARD_MIN_COVER_PX = 120;

/**
 * The visible rectangle while a keyboard covers part of the screen, else `null`. Pinch zoom (`scale` other than 1)
 * also shrinks the visual viewport, and must never re-lay out the app, so it is `null` too.
 */
export function keyboardFrame(viewport: ViewportBox, layoutHeight: number): KeyboardFrame | null {
  if (Math.abs(viewport.scale - 1) > 0.01) return null;
  if (layoutHeight - viewport.height < KEYBOARD_MIN_COVER_PX) return null;
  return { top: viewport.offsetTop, height: viewport.height };
}

/**
 * Keep `<html>` in step with the keyboard until the returned function is called, which also clears what was set.
 * Each time the frame shrinks (the keyboard can slide up over several resizes) the focused field is scrolled back
 * into view (`block: "nearest"`); the shell's scroller stops it above the action bar (`scroll-padding-bottom`).
 */
export function trackKeyboardFrame(win: Window = window): () => void {
  const viewport = win.visualViewport;
  if (!viewport) return () => {};
  const root = win.document.documentElement;
  // The frame last written, or null while the keyboard is down. Only a changed value is written: a custom property
  // on <html> restyles the whole page, and iOS sends a scroll event on every frame of a pan.
  let shown: KeyboardFrame | null = null;

  const clear = () => {
    root.removeAttribute("data-keyboard");
    root.style.removeProperty("--app-top");
    root.style.removeProperty("--app-height");
    shown = null;
  };

  const update = () => {
    const frame = keyboardFrame(viewport, root.clientHeight);
    if (!frame) {
      if (shown) clear();
      return;
    }
    const before = shown;
    shown = frame;
    if (frame.top !== before?.top) root.style.setProperty("--app-top", `${frame.top}px`);
    if (frame.height === before?.height) return;
    root.style.setProperty("--app-height", `${frame.height}px`);
    if (!before) root.setAttribute("data-keyboard", "open");
    // The keyboard may slide up over several resizes: reveal again each time the frame shrinks, never on a pan.
    if (before && frame.height > before.height) return;
    const focused = win.document.activeElement;
    if (focused instanceof HTMLElement && focused !== win.document.body) {
      focused.scrollIntoView?.({ block: "nearest" });
    }
  };

  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  update();
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    clear();
  };
}
