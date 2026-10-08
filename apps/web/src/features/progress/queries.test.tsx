import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProgressSeries } from "@sin/core";
import { deferred, makeQueryClient } from "../../test/workoutHarness";
import { makeProgressPoint } from "../../test/workoutFixtures";
import type { ProgressClient } from "./progressClient";
import { PROGRESS_KEYS, ProgressClientContext, ProgressClockContext, useSeries } from "./queries";
import type { Range } from "./range";

const ID = "10000000-0000-4000-8000-0000000000e1";
const seriesOf = (localDate: string): ProgressSeries =>
  ({ exerciseId: ID, points: [makeProgressPoint({ localDate })] }) as ProgressSeries;

function setup(getSeries: ProgressClient["getSeries"], clock: { today: string }) {
  const qc = makeQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ProgressClientContext.Provider value={{ getSeries }}>
        <ProgressClockContext.Provider value={() => clock.today}>{children}</ProgressClockContext.Provider>
      </ProgressClientContext.Provider>
    </QueryClientProvider>
  );
  return { qc, Wrapper };
}

/**
 * TanStack re-renders only for result props read during a render ("tracked props"); a test that reads
 * `isPlaceholderData` only after the change would never see it. Spreading reads every prop.
 */
const useSeriesSnapshot = ({ range }: { range: Range }) => ({ ...useSeries(ID, range) });

describe("08.1 AC7 — the series query", () => {
  it("from per range at fetch time; all sends none; key is ['progress', id, range]", async () => {
    const getSeries = vi.fn(async () => seriesOf("2026-10-01"));
    const clock = { today: "2026-10-08" };
    const { qc, Wrapper } = setup(getSeries, clock);
    const { result, rerender } = renderHook(useSeriesSnapshot, {
      wrapper: Wrapper,
      initialProps: { range: "3m" as Range },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    clock.today = "2026-10-09"; // the clock is read inside queryFn, not at render or key time
    rerender({ range: "1y" });
    await waitFor(() => expect(getSeries).toHaveBeenCalledTimes(2));
    rerender({ range: "all" });
    await waitFor(() => expect(getSeries).toHaveBeenCalledTimes(3));
    expect(getSeries.mock.calls).toEqual([
      [ID, { from: "2026-07-08" }],
      [ID, { from: "2025-10-09" }],
      [ID, {}],
    ]);
    expect(PROGRESS_KEYS.series(ID, "3m")).toEqual(["progress", ID, "3m"]);
    await waitFor(() => expect(qc.getQueryData(PROGRESS_KEYS.series(ID, "all"))).toBeDefined());
  });

  it("each range is its own cache entry: 3M → 1Y → 3M is two requests", async () => {
    const getSeries = vi.fn(async () => seriesOf("2026-10-01"));
    const { Wrapper } = setup(getSeries, { today: "2026-10-08" });
    const { result, rerender } = renderHook(useSeriesSnapshot, {
      wrapper: Wrapper,
      initialProps: { range: "3m" as Range },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ range: "1y" });
    await waitFor(() => expect(getSeries).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    rerender({ range: "3m" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSeries).toHaveBeenCalledTimes(2);
  });

  it("while a new range loads, data is the previous series flagged as placeholder", async () => {
    const second = deferred<ProgressSeries>();
    const getSeries = vi.fn().mockResolvedValueOnce(seriesOf("2026-10-01")).mockReturnValueOnce(second.promise);
    const { Wrapper } = setup(getSeries, { today: "2026-10-08" });
    const { result, rerender } = renderHook(useSeriesSnapshot, {
      wrapper: Wrapper,
      initialProps: { range: "3m" as Range },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ range: "1y" });
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
    expect(result.current.data!.points[0]!.localDate).toBe("2026-10-01");
    await act(async () => second.resolve(seriesOf("2025-12-01")));
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.data!.points[0]!.localDate).toBe("2025-12-01");
  });
});
