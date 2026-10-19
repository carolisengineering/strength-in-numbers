import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useKeepScreenAwake } from "./useKeepScreenAwake";

/** A fake `navigator.wakeLock`: each request returns a sentinel the test can release as the browser would. */
function installWakeLock(options: { reject?: boolean } = {}) {
  const sentinels: { released: boolean; release: ReturnType<typeof vi.fn>; drop: () => void }[] = [];
  const request = vi.fn(async (type: string) => {
    expect(type).toBe("screen");
    if (options.reject) throw new DOMException("Low battery", "NotAllowedError");
    const sentinel = {
      released: false,
      release: vi.fn(async () => {
        sentinel.released = true;
      }),
      drop: () => {
        sentinel.released = true;
      },
    };
    sentinels.push(sentinel);
    return sentinel;
  });
  Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
  return { request, sentinels };
}

let visibility: DocumentVisibilityState = "visible";
function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { get: () => visibility, configurable: true });
});

afterEach(() => {
  delete (navigator as { wakeLock?: unknown }).wakeLock;
});

const flush = () => act(async () => {});

describe("#108 — keep the screen awake during a workout", () => {
  it("asks for a screen wake lock while enabled, and releases it on unmount", async () => {
    const lock = installWakeLock();
    const { unmount } = renderHook(() => useKeepScreenAwake(true));
    await flush();
    expect(lock.request).toHaveBeenCalledTimes(1);

    unmount();
    expect(lock.sentinels[0]!.release).toHaveBeenCalledTimes(1);
  });

  it("asks for nothing when the preference is off", async () => {
    const lock = installWakeLock();
    renderHook(() => useKeepScreenAwake(false));
    await flush();
    expect(lock.request).not.toHaveBeenCalled();
  });

  it("asks again when the page comes back into view after the browser dropped the lock", async () => {
    const lock = installWakeLock();
    renderHook(() => useKeepScreenAwake(true));
    await flush();

    lock.sentinels[0]!.drop(); // the browser releases it when the page is hidden
    setVisibility("hidden");
    await flush();
    expect(lock.request).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await flush();
    expect(lock.request).toHaveBeenCalledTimes(2);
  });

  it("does not ask twice while it still holds a lock", async () => {
    const lock = installWakeLock();
    renderHook(() => useKeepScreenAwake(true));
    await flush();
    setVisibility("visible");
    await flush();
    expect(lock.request).toHaveBeenCalledTimes(1);
  });

  it("a refused request is quiet, and a browser without wake lock is a no-op", async () => {
    installWakeLock({ reject: true });
    const refused = renderHook(() => useKeepScreenAwake(true));
    await flush();
    refused.unmount();

    delete (navigator as { wakeLock?: unknown }).wakeLock;
    const none = renderHook(() => useKeepScreenAwake(true));
    await flush();
    expect(() => none.unmount()).not.toThrow();
  });

  it("a lock granted after unmount is released straight away", async () => {
    const lock = installWakeLock();
    const { unmount } = renderHook(() => useKeepScreenAwake(true));
    unmount(); // before the request resolves
    await flush();
    expect(lock.sentinels[0]!.release).toHaveBeenCalledTimes(1);
  });
});
