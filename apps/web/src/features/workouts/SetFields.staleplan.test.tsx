import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SetFields } from "./SetFields";
import { seedDraft, unitDefaultsFor } from "./setDraft";

describe("18.2 AC52 — a Duration card with a stale planned row shows no reps or weight input", () => {
  it("the seeded draft holds the stale values, but nothing renders them", () => {
    const draft = seedDraft({
      plannedSets: [{ setType: "working", repsLow: 8, repsHigh: 8, weight: 60, weightUnit: "kg" }],
      sets: [],
      defaults: unitDefaultsFor("kg", "duration"),
      attemptKey: "k",
    });
    expect(draft.reps).toBe("8");
    render(<SetFields variant="entry" modality="duration" draft={draft} errors={{}} idPrefix="t" onChange={() => {}} />);
    expect(screen.queryByLabelText("Reps")).toBeNull();
    expect(screen.queryByLabelText("Weight")).toBeNull();
    expect(screen.getByLabelText("Minutes")).toBeInTheDocument();
  });
});
