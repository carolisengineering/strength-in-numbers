import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SectionTimer, WorkoutDetail } from "@sin/core";
import { makeWorkoutDetail, type ExerciseSpec } from "../../../test/workoutFixtures";
import type { Regroup, RegroupOutcome } from "../useRegroup";
import type { SectionBanner } from "./useSectionActions";
import { useTimedGrouping } from "./useTimedGrouping";

const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const ex = (name: string, sectionIndex: number | null, supersetGroup: number | null = null): ExerciseSpec => ({ modality: "weight_reps", name, sectionIndex, supersetGroup });

function setup(detail: WorkoutDetail, outcomes: RegroupOutcome[]) {
  let current: WorkoutDetail = detail;
  const run = vi.fn<Regroup["run"]>(async () => outcomes.shift() ?? { status: "done" });
  const regroup: Regroup = { run, resend: vi.fn(), busy: false };
  const banners: (SectionBanner | null)[] = [];
  const structureLock = { current: false };
  const { result } = renderHook(() =>
    useTimedGrouping({ regroup, readDetail: () => current, setBanner: (b) => banners.push(b), structureLock }),
  );
  return { result, run, banners, structureLock, setDetail: (d: WorkoutDetail) => (current = d) };
}

const loose3 = () => makeWorkoutDetail({ sections: [{ name: "Warm-up" }, { name: "Main", timer: SET5 }], exercises: [ex("w", 0), ex("a", 1), ex("b", 1), ex("c", 1)] });

describe("10.7 AC22 / AC23 — useTimedGrouping", () => {
  it("sends each target through regroup.run with groupRange and the segment's offset", async () => {
    const d = loose3();
    const { result, run, banners } = setup(d, []);
    await act(() => result.current.couple(d.sections[1]!.id, "fill", "timer"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![1]).toEqual({ type: "groupRange", from: 0, to: 2 });
    expect(run.mock.calls[0]![2]).toEqual({ positionOffset: 1 });
    expect(banners).toEqual([]);
  });

  it("a refused plan shows its message as a warning", async () => {
    const d = loose3();
    const { result, banners } = setup(d, [{ status: "refused", message: "This workout has too many supersets" }]);
    await act(() => result.current.couple(d.sections[1]!.id, "fill", "timer"));
    expect(banners).toEqual([{ tone: "warning", text: "This workout has too many supersets" }]);
  });

  it.each<["timer" | "added" | "moved", string]>([
    ["timer", "Timer saved, but the exercises couldn't be grouped — try again"],
    ["added", "Exercise added, but it couldn't be grouped — try again"],
    ["moved", "Exercise moved, but it couldn't be grouped — try again"],
  ])("a failed regroup after %s raises the error banner with Try again", async (cause, text) => {
    const d = loose3();
    const { result, banners } = setup(d, [{ status: "failed", error: new Error("x"), retry: null }]);
    await act(() => result.current.couple(d.sections[1]!.id, "fill", cause));
    expect(banners).toHaveLength(1);
    expect(banners[0]).toMatchObject({ tone: "error", text });
    expect(typeof banners[0]!.retry).toBe("function");
  });

  it("Try again recomputes from the current detail: already grouped sends nothing and clears the banner (Review Focus 3)", async () => {
    const d = loose3();
    const { result, run, banners, setDetail, structureLock } = setup(d, [{ status: "failed", error: new Error("x"), retry: null }]);
    await act(() => result.current.couple(d.sections[1]!.id, "fill", "timer"));
    // Another device grouped them meanwhile.
    setDetail({ ...d, exercises: d.exercises.map((e) => (e.sectionId === d.sections[1]!.id ? { ...e, supersetGroup: 3 } : e)) });
    await act(async () => banners[0]!.retry!());
    expect(run).toHaveBeenCalledTimes(1);
    expect(banners.at(-1)).toBeNull();
    expect(structureLock.current).toBe(false);
  });

  it("Try again while another structure write holds the lock does nothing", async () => {
    const d = loose3();
    const { result, run, banners, structureLock } = setup(d, [{ status: "failed", error: new Error("x"), retry: null }]);
    await act(() => result.current.couple(d.sections[1]!.id, "fill", "timer"));
    structureLock.current = true;
    await act(async () => banners[0]!.retry!());
    expect(run).toHaveBeenCalledTimes(1);
    expect(banners).toHaveLength(1);
  });

  it("Try again re-runs and takes the lock itself", async () => {
    const d = loose3();
    const { result, run, banners, structureLock } = setup(d, [{ status: "failed", error: new Error("x"), retry: null }]);
    await act(() => result.current.couple(d.sections[1]!.id, "fill", "timer"));
    let locked = false;
    run.mockImplementationOnce(async () => {
      locked = structureLock.current;
      return { status: "done" };
    });
    await act(async () => banners[0]!.retry!());
    expect(run).toHaveBeenCalledTimes(2);
    expect(locked).toBe(true);
    expect(structureLock.current).toBe(false);
  });

  it("no detail, or nothing to group: no run, no banner", async () => {
    const d = makeWorkoutDetail({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("a", 0, 1), ex("b", 0, 1), ex("c", 0, 2), ex("d", 0, 2)] });
    const { result, run, banners } = setup(d, []);
    await act(() => result.current.couple(d.sections[0]!.id, "fill", "timer"));
    expect(run).not.toHaveBeenCalled();
    expect(banners).toEqual([]);
  });
});
