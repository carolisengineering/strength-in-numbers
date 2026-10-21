import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateWorkoutSchema } from "@sin/core";
import { finishEndedAt, finishTimestamp, startWorkoutFields } from "./timestamps";

afterEach(() => vi.restoreAllMocks());

describe("AC3 — start and finish timestamps", () => {
  it.each([
    [-120, 120], // UTC+02:00: getTimezoneOffset() is -120
    [300, -300], // UTC-05:00
  ])("negates getTimezoneOffset %i → %i", (raw, expected) => {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(raw);
    expect(startWorkoutFields(new Date("2026-10-02T10:00:00Z")).tzOffsetMinutes).toBe(expected);
  });

  it("UTC gives +0, never -0", () => {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
    expect(Object.is(startWorkoutFields(new Date()).tzOffsetMinutes, 0)).toBe(true);
  });

  it("startedAt is an ISO string the create schema accepts", () => {
    const fields = startWorkoutFields(new Date("2026-10-02T10:00:00Z"), () => -120);
    expect(
      CreateWorkoutSchema.safeParse({ clientGeneratedId: crypto.randomUUID(), ...fields }).success,
    ).toBe(true);
  });

  it("finishTimestamp returns now, clamped up to startedAt if the clock went backwards", () => {
    const started = "2026-10-02T10:00:00.000Z";
    expect(finishTimestamp(started, new Date("2026-10-02T10:30:00Z"))).toBe("2026-10-02T10:30:00.000Z");
    expect(finishTimestamp(started, new Date("2026-10-02T09:00:00Z"))).toBe(started);
  });
});

describe("18.0 AC37 — finishEndedAt", () => {
  const started = "2026-10-16T17:00:00.000Z";
  it("without a plan it is finishTimestamp: now, clamped up to the start", () => {
    expect(finishEndedAt(started, null, new Date("2026-10-18T10:00:00Z"))).toBe("2026-10-18T10:00:00.000Z");
    expect(finishEndedAt(started, null, new Date("2026-10-16T16:00:00Z"))).toBe(started);
  });
  it("with a plan it is start + plan, whatever now is", () => {
    for (const now of ["2026-10-16T17:30:00Z", "2026-10-18T10:00:00Z", "2030-01-01T00:00:00Z"]) {
      expect(finishEndedAt(started, 3600, new Date(now))).toBe("2026-10-16T18:00:00.000Z");
    }
  });
});
