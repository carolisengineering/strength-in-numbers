import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PersonalRecord } from "@sin/core";
import { makePersonalRecord } from "../../test/workoutFixtures";
import { RecordsSection } from "./RecordsSection";

const success = (data: PersonalRecord[]) =>
  ({ isPending: false, isError: false, data, error: null, refetch: async () => undefined }) as unknown as UseQueryResult<PersonalRecord[]>;

describe("08.1 AC19 — RecordsSection renders any records query", () => {
  it("renders a supplied query's records with 08.0's line format", () => {
    render(<RecordsSection query={success([makePersonalRecord({ exerciseName: "Barbell bench press" })])} unitPreference="kg" />);
    const block = screen.getByRole("region", { name: "Personal records" });
    expect(within(block).getByText("Barbell bench press — Heaviest weight 102.5 kg (was 100 kg)")).toBeInTheDocument();
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
