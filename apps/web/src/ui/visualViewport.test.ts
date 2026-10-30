import { afterEach, describe, expect, it, vi } from "vitest";

import { keyboardFrame, trackKeyboardFrame } from "./visualViewport";

/** A stand-in for `window.visualViewport`: the three numbers the shell reads, plus its events. */
class FakeViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  scale = 1;

  move(next: Partial<Pick<FakeViewport, "height" | "offsetTop" | "scale">>, type = "resize") {
    Object.assign(this, next);
    this.dispatchEvent(new Event(type));
  }
}

const LAYOUT = 844;

function fakeWindow(viewport: FakeViewport | null) {
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    get: () => LAYOUT,
  });
  return { visualViewport: viewport, document } as unknown as Window;
}

const root = document.documentElement;

afterEach(() => {
  // Back to jsdom's own clientHeight, so no later test sees the fake 844.
  delete (document.documentElement as { clientHeight?: number }).clientHeight;
  root.removeAttribute("data-keyboard");
  root.style.removeProperty("--app-top");
  root.style.removeProperty("--app-height");
  document.body.replaceChildren();
});

describe("#206 — keyboardFrame: the visible part of the screen while a keyboard is up", () => {
  it("is null with the keyboard down (the visible area is the layout viewport)", () => {
    expect(keyboardFrame({ height: 844, offsetTop: 0, scale: 1 }, LAYOUT)).toBeNull();
  });

  it("is null for a small difference such as a collapsing toolbar", () => {
    expect(keyboardFrame({ height: 790, offsetTop: 0, scale: 1 }, LAYOUT)).toBeNull();
  });

  it("is the visible rectangle when a keyboard covers part of the screen", () => {
    expect(keyboardFrame({ height: 508, offsetTop: 120, scale: 1 }, LAYOUT)).toEqual({
      top: 120,
      height: 508,
    });
  });

  it("is null while pinch-zoomed, so zooming never re-lays out the app", () => {
    expect(keyboardFrame({ height: 422, offsetTop: 0, scale: 2 }, LAYOUT)).toBeNull();
  });
});

describe("#204 #206 #207 — trackKeyboardFrame", () => {
  it("marks the page and sizes the frame while the keyboard is up, and clears both when it goes down", () => {
    const viewport = new FakeViewport();
    const stop = trackKeyboardFrame(fakeWindow(viewport));
    expect(root.hasAttribute("data-keyboard")).toBe(false);

    viewport.move({ height: 508, offsetTop: 0 });
    expect(root.dataset.keyboard).toBe("open");
    expect(root.style.getPropertyValue("--app-top")).toBe("0px");
    expect(root.style.getPropertyValue("--app-height")).toBe("508px");

    // iOS pans the visible area to the field: the frame follows it.
    viewport.move({ offsetTop: 96 }, "scroll");
    expect(root.style.getPropertyValue("--app-top")).toBe("96px");

    viewport.move({ height: 844, offsetTop: 0 });
    expect(root.hasAttribute("data-keyboard")).toBe(false);
    expect(root.style.getPropertyValue("--app-top")).toBe("");
    expect(root.style.getPropertyValue("--app-height")).toBe("");
    stop();
  });

  it("reads the viewport at once, so a keyboard already up when the shell mounts is honored", () => {
    const viewport = new FakeViewport();
    viewport.height = 500;
    const stop = trackKeyboardFrame(fakeWindow(viewport));
    expect(root.dataset.keyboard).toBe("open");
    stop();
  });

  it("brings the focused field back into view once the frame shrinks", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const reveal = vi.fn();
    input.scrollIntoView = reveal;

    const viewport = new FakeViewport();
    const stop = trackKeyboardFrame(fakeWindow(viewport));
    viewport.move({ height: 508 });
    expect(reveal).toHaveBeenCalledWith({ block: "nearest" });

    // Only on opening, not on every pan while it is up.
    viewport.move({ offsetTop: 40 }, "scroll");
    expect(reveal).toHaveBeenCalledTimes(1);
    stop();
  });

  it("brings it into view again each time the frame shrinks while the keyboard slides up", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const reveal = vi.fn();
    input.scrollIntoView = reveal;

    const viewport = new FakeViewport();
    const stop = trackKeyboardFrame(fakeWindow(viewport));
    viewport.move({ height: 700 }); // mid-animation
    viewport.move({ height: 508 }); // settled
    expect(reveal).toHaveBeenCalledTimes(2);

    viewport.move({ height: 560 }); // growing (the suggestion strip went away) needs no reveal
    expect(reveal).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops listening and clears what it set when stopped", () => {
    const viewport = new FakeViewport();
    const stop = trackKeyboardFrame(fakeWindow(viewport));
    viewport.move({ height: 508 });
    stop();
    expect(root.hasAttribute("data-keyboard")).toBe(false);
    expect(root.style.getPropertyValue("--app-height")).toBe("");

    viewport.move({ height: 400 });
    expect(root.hasAttribute("data-keyboard")).toBe(false);
  });

  it("does nothing where the browser has no visualViewport", () => {
    const stop = trackKeyboardFrame(fakeWindow(null));
    expect(root.hasAttribute("data-keyboard")).toBe(false);
    expect(() => stop()).not.toThrow();
  });
});
