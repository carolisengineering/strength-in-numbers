import { describe, expect, it } from "vitest";

import { cleanupApp } from "../../test/workoutHarness";
import { firstScrollOf } from "./refusalScroll";

describe("minor 699 — the refused-banner scroll set resets between tests", () => {
  it("minor 699: the shared cleanupApp clears it", () => {
    expect(firstScrollOf("op-1")).toBe(true);
    expect(firstScrollOf("op-1")).toBe(false);
    cleanupApp();
    expect(firstScrollOf("op-1")).toBe(true);
    cleanupApp();
  });
});
