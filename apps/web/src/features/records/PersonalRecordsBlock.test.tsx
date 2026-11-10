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
import type { LedgerSection } from "./recordLedger";

const W = "50000000-0000-4000-8000-000000000001";
type Workout = ReturnType<typeof makeWorkoutDetail>;

function renderBlock(listRecords: RecordsClient["listRecords"], workout: Workout = makeWorkoutDetail({ exercises: [] }), o: { unitPreference?: UnitPreference; section?: LedgerSection } = {}) {
  const qc = makeQueryClient();
  const { container } = render(
    <QueryClientProvider client={qc}>
      <RecordsClientContext.Provider value={{ listRecords }}>
        <PersonalRecordsBlock workoutId={W} unitPreference={o.unitPreference ?? "kg"} workout={workout} section={o.section ?? "workouts"} />
      </RecordsClientContext.Provider>
    </QueryClientProvider>,
  );
  return { qc, container, user: userEvent.setup() };
}

const lift = (name: string): ExerciseSpec => ({ modality: "weight_reps", name, sets: [makeSet({ reps: 5, weight: 190, weightKg: 190 })] });
const workoutOf = (names: string[]) => makeWorkoutDetail({ exercises: names.map(lift) });
const recOf = (w: Workout, i: number, o: Record<string, unknown> = {}) => {
  const e = w.exercises[i]!;
  return makePersonalRecord({ exerciseId: e.exerciseId, sourceExerciseId: e.exerciseId, exerciseName: e.exerciseNameSnapshot, sourceSetId: e.sets[0]!.id, workoutId: w.id, ...o });
};
const beaten = (w: Workout, i: number) => recOf(w, i, { recordType: "heaviest_weight", value: 190, previousValue: 185 });
const first = (w: Workout, i: number) => recOf(w, i, { recordType: "heaviest_weight", value: 32.5, previousValue: null });
const failure = (requestId: string) => new ApiError({ status: 500, type: "about:blank", title: "Server Error", requestId });

describe("17.6 AC1 / 17.2 AC28 — the summary never waits on records", () => {
  it("renders nothing, and no spinner, while pending", () => {
    const pending = deferred<PersonalRecord[]>();
    const { container } = renderBlock(() => pending.promise);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders nothing for no records", async () => {
    const listRecords = vi.fn(async () => []);
    const { container } = renderBlock(listRecords);
    await waitFor(() => expect(listRecords).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("Review Focus 5: a failed refetch keeps the panel, adds the notice, and leaves an expanded list expanded", async () => {
    const w = workoutOf(["A", "B", "C", "D", "E"]);
    const listRecords = vi.fn<RecordsClient["listRecords"]>().mockResolvedValueOnce(w.exercises.map((_, i) => beaten(w, i))).mockRejectedValueOnce(failure("req-2"));
    const { qc, user } = renderBlock(listRecords, w);
    const panel = await screen.findByRole("region", { name: "New records on 5 lifts" });
    await user.click(within(panel).getByRole("button", { name: "Show all 5 lifts" }));
    await qc.invalidateQueries({ queryKey: ["records"] });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load records");
    expect(screen.getByRole("region", { name: "New records on 5 lifts" })).toBe(panel);
    expect(within(panel).getAllByRole("heading", { level: 3 })).toHaveLength(5);
    expect(within(panel).getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  });

  it("Review Focus 5: first-only records keep their quiet lines beside the notice", async () => {
    const w = workoutOf(["Triceps Pushdown"]);
    const listRecords = vi.fn<RecordsClient["listRecords"]>().mockResolvedValueOnce([first(w, 0)]).mockRejectedValueOnce(failure("req-3"));
    const { qc } = renderBlock(listRecords, w);
    await screen.findByText("First time logged: Triceps Pushdown 32.5 kg");
    await qc.invalidateQueries({ queryKey: ["records"] });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load records");
    expect(screen.getByText("First time logged: Triceps Pushdown 32.5 kg")).toBeInTheDocument();
  });

  it("Review Focus 5: a failure with nothing cached is the notice alone, with no heading and no panel; Try again recovers", async () => {
    const w = workoutOf(["Bench Press"]);
    const listRecords = vi.fn<RecordsClient["listRecords"]>().mockRejectedValueOnce(failure("req-1")).mockResolvedValueOnce([beaten(w, 0)]);
    const { container, user } = renderBlock(listRecords, w);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load records");
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector("section")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "New record" })).toBeInTheDocument();
  });

  it("an lb account reads its ledger in lb", async () => {
    const w = workoutOf(["Bench Press"]);
    renderBlock(async () => [recOf(w, 0, { recordType: "heaviest_weight", value: storedKg(225), previousValue: storedKg(220) })], w, { unitPreference: "lb" });
    const panel = await screen.findByRole("region", { name: "New record" });
    expect(within(panel).getByText("Heaviest weight: was 220 lb, now 225 lb, up 5 lb")).toBeInTheDocument();
  });
});

describe("17.6 AC13 — no brass without a beaten record", () => {
  it("first-only: no panel and no heading, the quiet line shown", async () => {
    const w = workoutOf(["Triceps Pushdown"]);
    const { container } = renderBlock(async () => [first(w, 0)], w);
    expect(await screen.findByText("First time logged: Triceps Pushdown 32.5 kg")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector("section")).toBeNull();
  });
});

describe("17.6 AC14 / 17.2 AC24 — set volume only is nothing", () => {
  it("a workout whose only records are set volume renders nothing", async () => {
    const w = workoutOf(["Bench Press"]);
    const listRecords = vi.fn(async () => [recOf(w, 0, { recordType: "best_set_volume", value: 950, previousValue: 900, unit: "kg_reps" })]);
    const { container } = renderBlock(listRecords, w);
    await waitFor(() => expect(listRecords).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("17.6 AC15 — the section prop picks the wording", () => {
  it("History reads Records from this workout", async () => {
    const w = workoutOf(["Bench Press", "Squat"]);
    renderBlock(async () => [beaten(w, 0), beaten(w, 1)], w, { section: "history" });
    expect(await screen.findByRole("region", { name: "Records from this workout on 2 lifts" })).toBeInTheDocument();
  });
});
