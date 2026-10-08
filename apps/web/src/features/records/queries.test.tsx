import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeQueryClient } from "../../test/workoutHarness";
import { RECORDS_KEYS, RecordsClientContext, useAllRecords, useExerciseRecords } from "./queries";
import type { RecordsClient } from "./recordsClient";

function wrapper(listRecords: RecordsClient["listRecords"]) {
  const qc = makeQueryClient();
  return {
    qc,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <RecordsClientContext.Provider value={{ listRecords }}>{children}</RecordsClientContext.Provider>
      </QueryClientProvider>
    ),
  };
}

describe("08.1 AC6 — records list and exercise queries", () => {
  it("useAllRecords requests every record, unfiltered, under ['records','all']", async () => {
    const listRecords = vi.fn(async () => []);
    const { qc, Wrapper } = wrapper(listRecords);
    const { result } = renderHook(() => useAllRecords(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listRecords).toHaveBeenCalledWith({});
    expect(RECORDS_KEYS.list).toEqual(["records", "all"]);
    expect(qc.getQueryData(RECORDS_KEYS.list)).toEqual([]);
  });

  it("useExerciseRecords filters by exerciseId under 08.0's forExercise key", async () => {
    const listRecords = vi.fn(async () => []);
    const { qc, Wrapper } = wrapper(listRecords);
    const { result } = renderHook(() => useExerciseRecords("e-1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listRecords).toHaveBeenCalledWith({ exerciseId: "e-1" });
    expect(qc.getQueryData(RECORDS_KEYS.forExercise("e-1"))).toEqual([]);
  });
});
