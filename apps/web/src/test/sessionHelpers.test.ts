import { afterEach, describe, expect, it, vi } from "vitest";

import { DOUBLE_TAP_MS } from "../features/workouts/logAction";
import { restBetweenSets } from "./sessionHelpers";

afterEach(() => {
  vi.useRealTimers();
});

describe("Minor 237 — restBetweenSets clears the double-tap window", () => {
  it("with Date faked (frozen), it moves the clock past DOUBLE_TAP_MS itself", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const before = Date.now();
    await restBetweenSets();
    expect(Date.now() - before).toBeGreaterThanOrEqual(DOUBLE_TAP_MS);
  });

  it("with real timers, it just waits about 650 ms", async () => {
    const before = Date.now();
    await restBetweenSets();
    expect(vi.isFakeTimers()).toBe(false);
    expect(Date.now() - before).toBeGreaterThanOrEqual(600);
  });
});
