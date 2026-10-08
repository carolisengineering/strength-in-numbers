import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { PersonalRecord, UnitPreference } from "@sin/core";

const observability = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { ApiError } from "../../api";
import { deferred, makeQueryClient } from "../../test/workoutHarness";
import { makePersonalRecord } from "../../test/workoutFixtures";
import { PersonalRecordsBlock } from "./PersonalRecordsBlock";
import { RecordsClientContext } from "./queries";
import type { RecordsClient } from "./recordsClient";

const W = "50000000-0000-4000-8000-000000000001";

function renderBlock(listRecords: RecordsClient["listRecords"], unitPreference: UnitPreference = "kg") {
  const qc = makeQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <RecordsClientContext.Provider value={{ listRecords }}>
        <PersonalRecordsBlock workoutId={W} unitPreference={unitPreference} />
      </RecordsClientContext.Provider>
    </QueryClientProvider>,
  );
  return { qc, user: userEvent.setup() };
}

const records: PersonalRecord[] = [
  makePersonalRecord({ exerciseName: "Pull-up", recordType: "max_reps", value: 12, unit: "reps", previousValue: 10 }),
  makePersonalRecord({ exerciseName: "Bench Press", recordType: "best_est_1rm", value: 122.5, unit: "kg", previousValue: null }),
  makePersonalRecord({ exerciseName: "Bench Press", recordType: "heaviest_weight", value: 102.5, unit: "kg", previousValue: 100 }),
  makePersonalRecord({ exerciseName: "Bench Press", recordType: "best_set_volume", value: 1025, unit: "kg_reps", previousValue: 1000 }),
];

describe("08.0 AC18 — the Personal records block", () => {
  it("lists each record with its label, value and previous best, ordered by name then type", async () => {
    renderBlock(async () => records);

    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Bench Press — Heaviest weight 102.5 kg (was 100 kg)",
      "Bench Press — Best est. 1RM 122.5 kg (first record)",
      "Bench Press — Best set volume 1,025 kg (was 1,000 kg)",
      "Pull-up — Most reps 12 reps (was 10 reps)",
    ]);
  });

  it("formats values in lb for an lb profile (reps unconverted)", async () => {
    renderBlock(async () => [records[2]!, records[0]!], "lb");

    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByText("Bench Press — Heaviest weight 226 lb (was 220.5 lb)")).toBeInTheDocument();
    expect(within(block).getByText("Pull-up — Most reps 12 reps (was 10 reps)")).toBeInTheDocument();
  });

  it("names a record by its snapshot, not the catalog", async () => {
    renderBlock(async () => [makePersonalRecord({ exerciseName: "My Old Bench Name" })]);
    expect(await screen.findByText(/^My Old Bench Name — /)).toBeInTheDocument();
  });
});

describe("08.0 AC19 — the block's states", () => {
  it("renders nothing for no records", async () => {
    const listRecords = vi.fn(async () => []);
    renderBlock(listRecords);
    await waitFor(() => expect(listRecords).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("region", { name: "Personal records" })).toBeNull());
    expect(screen.queryByText("Personal records")).toBeNull();
  });

  it("renders nothing (no spinner) while pending", () => {
    const pending = deferred<PersonalRecord[]>();
    renderBlock(() => pending.promise);
    expect(screen.queryByRole("region", { name: "Personal records" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a failed background refetch keeps the records it already shows, with the notice (code review)", async () => {
    const listRecords = vi
      .fn<RecordsClient["listRecords"]>()
      .mockResolvedValueOnce([records[2]!])
      .mockRejectedValueOnce(new ApiError({ status: 500, type: "about:blank", title: "Server Error", requestId: "req-2" }));
    const { qc } = renderBlock(listRecords);
    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByText(/Heaviest weight 102\.5 kg/)).toBeInTheDocument();

    await qc.invalidateQueries({ queryKey: ["records"] });

    expect(await within(block).findByRole("alert")).toHaveTextContent("Couldn't load records");
    expect(within(block).getByText(/Heaviest weight 102\.5 kg/)).toBeInTheDocument();
  });

  it("shows a block-local notice on failure, and Try again refetches", async () => {
    const listRecords = vi
      .fn<RecordsClient["listRecords"]>()
      .mockRejectedValueOnce(new ApiError({ status: 500, type: "about:blank", title: "Server Error", requestId: "req-1" }))
      .mockResolvedValueOnce([records[2]!]);
    const { user } = renderBlock(listRecords);

    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByRole("alert")).toHaveTextContent("Couldn't load records");
    await user.click(within(block).getByRole("button", { name: "Try again" }));
    expect(await within(block).findByText(/Heaviest weight 102\.5 kg/)).toBeInTheDocument();
  });
});
