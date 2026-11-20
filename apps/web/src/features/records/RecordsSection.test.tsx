import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PersonalRecord } from "@sin/core";
import { makePersonalRecord } from "../../test/workoutFixtures";
import { RecordsSection } from "./RecordsSection";

const success = (data: PersonalRecord[]) =>
  ({ isPending: false, isError: false, data, error: null, refetch: async () => undefined }) as unknown as UseQueryResult<PersonalRecord[]>;

const failed = (data: PersonalRecord[] | undefined) =>
  ({ isPending: false, isError: true, data, error: new Error("boom"), refetch: async () => undefined }) as unknown as UseQueryResult<
    PersonalRecord[]
  >;

describe("08.1 AC19 — RecordsSection renders any records query", () => {
  it("renders a supplied query's records as name-free rows (17.11 AC7)", () => {
    render(<RecordsSection query={success([makePersonalRecord({ exerciseName: "Barbell bench press" })])} unitPreference="kg" />);
    const block = screen.getByRole("region", { name: "Personal records" });
    expect(within(block).getByRole("listitem").textContent).toBe("Heaviest weight: 102.5 kg, was 100 kg");
  });

  it("all four types including volume; [] → absent", () => {
    const { rerender } = render(
      <RecordsSection
        query={success([
          makePersonalRecord({ recordType: "best_set_volume", value: 1025, unit: "kg_reps", previousValue: null }),
          makePersonalRecord({ recordType: "max_reps", value: 12, unit: "reps", previousValue: 10, exerciseName: "Pull-up" }),
        ])}
        unitPreference="kg"
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    rerender(<RecordsSection query={success([])} unitPreference="kg" />);
    expect(screen.queryByRole("region", { name: "Personal records" })).toBeNull();
  });
});

describe("17.11 AC7 — a failed records read beside rows (Review Focus 4)", () => {
  it("a failed refresh shows the notice above the rows and drops none", () => {
    render(
      <RecordsSection
        query={failed([
          makePersonalRecord({ value: 82.5, previousValue: 80 }),
          makePersonalRecord({ recordType: "max_reps", unit: "reps", value: 12, previousValue: 10 }),
        ])}
        unitPreference="kg"
      />,
    );
    const block = screen.getByRole("region", { name: "Personal records" });
    const notice = within(block).getByText("Couldn't load records");
    const list = within(block).getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(notice.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a failed first load shows the notice and no empty list", () => {
    render(<RecordsSection query={failed(undefined)} unitPreference="kg" />);
    const block = screen.getByRole("region", { name: "Personal records" });
    expect(within(block).getByText("Couldn't load records")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("07.5 AC39 — the exercise page lists one line per weight", () => {
  const ROOT = "10000000-0000-4000-8000-0000000000e2";
  const reps = (atWeightKg: number, day: number, value = 15, previousValue: number | null = 13) =>
    makePersonalRecord({
      exerciseId: ROOT,
      sourceExerciseId: ROOT,
      exerciseName: "Lateral Raise",
      recordType: "max_reps_at_weight",
      unit: "reps",
      value,
      previousValue,
      atWeightKg,
      achievedAt: `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
    });
  const rowTexts = () =>
    within(screen.getByRole("list"))
      .getAllByRole("listitem")
      .map((li) => li.textContent);

  it("a row reads Most reps at 12.5 kg, 15 reps, was 13 reps; a first time reads First record", () => {
    render(<RecordsSection query={success([reps(12.5, 2), reps(15, 3, 8, null)])} unitPreference="kg" />);
    const [heavier, lighter] = rowTexts();
    expect(lighter).toContain("Most reps at 12.5\u00a0kg");
    expect(lighter).toContain("15 reps");
    expect(lighter).toContain("was 13 reps");
    expect(heavier).toContain("Most reps at 15\u00a0kg");
    expect(heavier).toContain("First record");
    expect(screen.queryByRole("button", { name: /^Show / })).toBeNull();
  });

  it("one lineage under two names (a rename or a copy) still lists by type, then the heavier weight", () => {
    const heaviest = makePersonalRecord({ exerciseId: ROOT, sourceExerciseId: ROOT, exerciseName: "Lateral Raise", recordType: "heaviest_weight", value: 15 });
    const renamed = (atWeightKg: number) => ({ ...reps(atWeightKg, 4), exerciseName: "Cable Lateral Raise" });
    render(<RecordsSection query={success([reps(10, 2), renamed(15), heaviest, renamed(12.5)])} unitPreference="kg" />);
    expect(rowTexts().map((t) => t!.split(/[\d:]/)[0]!.trim())).toEqual(["Heaviest weight", "Most reps at", "Most reps at", "Most reps at"]);
    expect(rowTexts().slice(1).map((t) => /at ([\d.]+)/.exec(t!)![1])).toEqual(["15", "12.5", "10"]);
  });

  it("8 weights show 5 and Show all 8 weights; a tap shows all 8 and Show fewer", async () => {
    const user = userEvent.setup();
    render(<RecordsSection query={success([10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5].map((w, i) => reps(w, i + 1)))} unitPreference="kg" />);
    expect(rowTexts()).toHaveLength(5);
    const toggle = screen.getByRole("button", { name: "Show all 8 weights" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(rowTexts()).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  });
});
