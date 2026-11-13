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
