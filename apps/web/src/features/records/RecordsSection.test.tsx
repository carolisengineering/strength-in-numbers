import { render, screen, within } from "@testing-library/react";
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
