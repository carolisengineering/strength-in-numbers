import { renderHook } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SectionTimer, WorkoutDetail } from "@sin/core";
import { makeWorkoutDetail } from "../../../test/workoutFixtures";
import { useResultActions } from "./useResultActions";

const BASE = makeWorkoutDetail({ sections: [{ name: "Main", timer: { format: "amrap", capSeconds: 900 } }], exercises: [] });
const withTimer = (timer: SectionTimer): WorkoutDetail => ({ ...BASE, sections: BASE.sections.map((s) => ({ ...s, timer })) });

describe("code review #5 — the sheet is never drawn against another timer shape", () => {
  it("in the render that first sees an AMRAP turned Set Timer, `sheet` is already null", () => {
    const sheets: (string | null)[] = [];
    const writer = { save: vi.fn() };
    const { result, rerender } = renderHook(
      ({ workout }) => {
        const actions = useResultActions({ workout, writer, announce: vi.fn() });
        sheets.push(actions.sheet ? actions.sheet.section.timer.format : null);
        return actions;
      },
      { initialProps: { workout: withTimer({ format: "amrap", capSeconds: 900 }) } },
    );
    act(() => result.current.open(BASE.sections[0]!.id));
    expect(sheets.at(-1)).toBe("amrap");
    const before = sheets.length;
    rerender({ workout: withTimer({ format: "set_timer", rounds: 5, roundSeconds: 300 }) });
    // The first render with the new timer must not draw the old draft against it.
    expect(sheets[before]).toBeNull();
  });
});

describe("minor 557 — every failed Save is a new failure, even with the same words", () => {
  it("two failed saves give two different error objects with the same text", async () => {
    const writer = { save: vi.fn().mockResolvedValue({ ok: false }) };
    const { result } = renderHook(() => useResultActions({ workout: BASE, writer, announce: vi.fn() }));
    act(() => result.current.open(BASE.sections[0]!.id));
    const draft = { format: "amrap" as const, rows: [], rounds: "5", reps: "0", mode: "finished" as const, finishDigits: "" };
    await act(() => result.current.save(draft));
    const first = result.current.formError;
    await act(() => result.current.save(draft));
    const second = result.current.formError;
    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
    expect(typeof second === "string" ? second : second?.text).toBe(typeof first === "string" ? first : first?.text);
  });
});
