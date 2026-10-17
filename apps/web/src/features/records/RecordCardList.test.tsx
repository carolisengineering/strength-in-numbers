import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { PersonalRecord, UnitPreference } from "@sin/core";

const observability = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { ApiError } from "../../api";
import { deferred, makeQueryClient } from "../../test/workoutHarness";
import { makePersonalRecord, makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { storedKg } from "../../test/units";
import { PersonalRecordsBlock } from "./PersonalRecordsBlock";
import { RecordsClientContext } from "./queries";
import type { RecordsClient } from "./recordsClient";

const W = "50000000-0000-4000-8000-000000000001";

function renderBlock(listRecords: RecordsClient["listRecords"], unitPreference: UnitPreference = "kg", workout = makeWorkoutDetail({ exercises: [] })) {
  const qc = makeQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <RecordsClientContext.Provider value={{ listRecords }}>
        <PersonalRecordsBlock workoutId={W} unitPreference={unitPreference} workout={workout} />
      </RecordsClientContext.Provider>
    </QueryClientProvider>,
  );
  return { qc, user: userEvent.setup() };
}

const records: PersonalRecord[] = [
  makePersonalRecord({ exerciseName: "Pull-up", recordType: "max_reps", value: 12, unit: "reps", previousValue: 10 }),
  makePersonalRecord({ exerciseName: "Bench Press", recordType: "best_est_1rm", value: 122.5, unit: "kg", previousValue: null }),
  makePersonalRecord({ exerciseName: "Bench Press", recordType: "heaviest_weight", value: 102.5, unit: "kg", previousValue: 100 }),
];

const bench = (name = "Bench Press"): ExerciseSpec => ({ modality: "weight_reps", name, sets: [makeSet({ reps: 5, weight: 190, weightKg: 190 })] });
function withRecords(specs: ExerciseSpec[], make: (w: ReturnType<typeof makeWorkoutDetail>) => PersonalRecord[]) {
  const workout = makeWorkoutDetail({ exercises: specs });
  return { workout, records: make(workout) };
}
const recOf = (w: ReturnType<typeof makeWorkoutDetail>, i: number, o: Record<string, unknown> = {}) => {
  const e = w.exercises[i]!;
  return makePersonalRecord({ exerciseId: e.exerciseId, sourceExerciseId: e.exerciseId, exerciseName: e.exerciseNameSnapshot, sourceSetId: e.sets[0]!.id, workoutId: w.id, ...o });
};

describe("17.2 AC15 / AC18 / AC20 / AC26 — one record card per exercise", () => {
  it("shows a lead with its gain and was, the other records as chips, set volume nowhere, and N new", async () => {
    const { workout, records } = withRecords([bench()], (w) => [
      recOf(w, 0, { recordType: "heaviest_weight", value: 190, previousValue: 185 }),
      recOf(w, 0, { recordType: "best_est_1rm", value: 221.67, previousValue: 215 }),
      recOf(w, 0, { recordType: "best_set_volume", value: 950, previousValue: 900, unit: "kg_reps" }),
    ]);
    renderBlock(async () => records, "kg", workout);
    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByText("2 new")).toBeInTheDocument();
    const card = within(block).getByRole("heading", { level: 3, name: "Bench Press" }).closest("li")!;
    expect(within(card).getByText("190 kg × 5")).toBeInTheDocument();
    expect(within(card).getByText("Heaviest weight")).toBeInTheDocument();
    expect(within(card).getByText("190 kg")).toBeInTheDocument();
    expect(within(card).getByText("+5 kg")).toBeInTheDocument();
    expect(within(card).getByText("was 185 kg")).toBeInTheDocument();
    const chips = within(card).getByRole("list", { name: "Also set records for Bench Press" });
    expect(within(chips).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Est. 1RM"]);
    expect(within(block).queryByText(/volume/i)).toBeNull();
  });

  it("a first record says First record, with no gain and no was", async () => {
    const { workout, records } = withRecords([bench()], (w) => [recOf(w, 0, { recordType: "heaviest_weight", value: 190, previousValue: null })]);
    renderBlock(async () => records, "kg", workout);
    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByText("First record")).toBeInTheDocument();
    expect(within(block).queryByText(/^was /)).toBeNull();
    expect(within(block).queryByText(/^\+/)).toBeNull();
    expect(within(block).queryByRole("list", { name: /Also set records/ })).toBeNull();
  });

  it("an lb account sees values and gains in lb", async () => {
    const { workout, records } = withRecords([bench()], (w) => [recOf(w, 0, { recordType: "heaviest_weight", value: storedKg(225), previousValue: storedKg(220) })]);
    renderBlock(async () => records, "lb", workout);
    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByText("225 lb")).toBeInTheDocument();
    expect(within(block).getByText("+5 lb")).toBeInTheDocument();
    expect(within(block).getByText("was 220 lb")).toBeInTheDocument();
  });

  it("12 record-holding exercises render 12 cards with no cap", async () => {
    const { workout, records } = withRecords(Array.from({ length: 12 }, (_, i) => bench(`Lift ${i}`)), (w) => w.exercises.map((_, i) => recOf(w, i, { recordType: "heaviest_weight", value: 190, previousValue: 185 })));
    renderBlock(async () => records, "kg", workout);
    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getAllByRole("heading", { level: 3 })).toHaveLength(12);
    expect(within(block).getByText("12 new")).toBeInTheDocument();
    expect(within(block).queryByText(/show more/i)).toBeNull();
  });

  it("names a card by its snapshot, not the catalog", async () => {
    const { workout, records } = withRecords([bench("My Old Bench Name")], (w) => [recOf(w, 0, { recordType: "heaviest_weight", value: 190, previousValue: 185 })]);
    renderBlock(async () => records, "kg", workout);
    expect(await screen.findByRole("heading", { level: 3, name: "My Old Bench Name" })).toBeInTheDocument();
  });
});

describe("17.2 AC16 / AC24 — nothing to show means no section", () => {
  it("a workout whose only records are set volume has no section and no brass", async () => {
    const { workout, records } = withRecords([bench()], (w) => [recOf(w, 0, { recordType: "best_set_volume", value: 950, previousValue: 900, unit: "kg_reps" })]);
    const listRecords = vi.fn(async () => records);
    renderBlock(listRecords, "kg", workout);
    await waitFor(() => expect(listRecords).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("region", { name: "Personal records" })).toBeNull());
    expect(screen.queryByText(/new$/)).toBeNull();
  });
});

describe("17.2 AC28 — the block states are unchanged from 08.0 AC19", () => {
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
    expect(within(block).getByText("Heaviest weight")).toBeInTheDocument();

    await qc.invalidateQueries({ queryKey: ["records"] });

    expect(await within(block).findByRole("alert")).toHaveTextContent("Couldn't load records");
    expect(within(block).getByText("Heaviest weight")).toBeInTheDocument();
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
    expect(await within(block).findByText("Heaviest weight")).toBeInTheDocument();
  });
});
