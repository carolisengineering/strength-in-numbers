import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DISTANCE_UNIT_VALUES, SET_CALORIES_MAX, type Modality } from "@sin/core";
import { render, screen, within } from "@testing-library/react";
import { chooseSegmentValue, querySegmented, segmented, segmentValues } from "../../test/controls";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SetFields, type DraftEditField } from "./SetFields";
import { draftFromSet, unitDefaultsFor, type SetDraft } from "./setDraft";

const draftFor = (modality: Modality, o: Partial<SetDraft> = {}): SetDraft => ({ ...draftFromSet(null, unitDefaultsFor("kg", modality), "k"), ...o });

function Entry({ modality, initial, onChange }: { modality: Modality; initial: SetDraft; onChange?: (f: DraftEditField, v: string) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <SetFields
      variant="entry"
      exerciseName="X"
      modality={modality}
      draft={draft}
      errors={{}}
      idPrefix="t"
      onChange={(field, value) => {
        onChange?.(field, value);
        setDraft((d) => ({ ...d, [field]: value }));
      }}
    />
  );
}
const openOptions = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: /^More set options for / }));
// Labels and legends: since Spec 17.7 the unit and type controls are named by a legend.
const optionLabels = () => [...document.querySelectorAll("label, legend")].map((l) => l.textContent);

describe("18.1 AC5 — calories panel", () => {
  it("one Calories · cal stepper with a numeric text input, and no other measure", () => {
    render(<Entry modality="calories" initial={draftFor("calories", { calories: "20" })} />);
    const group = screen.getByRole("group", { name: "Calories · cal" });
    expect(within(group).getByLabelText("Calories")).toHaveAttribute("inputmode", "numeric");
    for (const label of ["Weight", "Reps", "Distance", "Minutes", "Seconds"]) expect(screen.queryByLabelText(label)).toBeNull();
  });
  it("More holds only the Set type", async () => {
    const user = userEvent.setup();
    render(<Entry modality="calories" initial={draftFor("calories")} />);
    await openOptions(user);
    expect(segmented("Set type")).toBeInTheDocument();
    expect(querySegmented("Weight unit")).toBeNull();
    expect(querySegmented("Distance unit")).toBeNull();
  });
  it("+ dispatches an ordinary edit with 25 from 20; + is disabled at the max", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { unmount } = render(<Entry modality="calories" initial={draftFor("calories", { calories: "20" })} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "+5, increase calories for X" }));
    expect(onChange).toHaveBeenCalledWith("calories", "25");
    expect(screen.getByLabelText("Calories")).toHaveValue("25");
    unmount();
    render(<Entry modality="calories" initial={draftFor("calories", { calories: String(SET_CALORIES_MAX) })} />);
    expect(screen.getByRole("button", { name: "+5, increase calories for X" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "\u22125, decrease calories for X" })).toBeEnabled();
  });
});

describe("18.1 AC7 — weight + distance panel", () => {
  it("a Weight stepper and a Distance (m) input; no reps", () => {
    render(<Entry modality="weight_distance" initial={draftFor("weight_distance", { weight: "24" })} />);
    expect(screen.getByRole("button", { name: "+2.5 kg, increase weight for X" })).toBeInTheDocument();
    expect(screen.getByLabelText("Distance (m)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Reps")).toBeNull();
  });
  it("More holds Set type, Weight unit and Distance unit (m, km, mi, ft)", async () => {
    const user = userEvent.setup();
    render(<Entry modality="weight_distance" initial={draftFor("weight_distance")} />);
    await openOptions(user);
    expect(segmented("Set type")).toBeInTheDocument();
    expect(segmented("Weight unit")).toBeInTheDocument();
    const units = segmentValues("Distance unit");
    expect(units).toEqual([...DISTANCE_UNIT_VALUES]);
  });
});

describe("18.1 AC8 — weight + duration panel", () => {
  it("a Weight stepper, Minutes and Seconds; no reps; More has no Distance unit", async () => {
    const user = userEvent.setup();
    render(<Entry modality="weight_duration" initial={draftFor("weight_duration")} />);
    expect(screen.getByRole("button", { name: "+2.5 kg, increase weight for X" })).toBeInTheDocument();
    expect(screen.getByLabelText("Minutes")).toBeInTheDocument();
    expect(screen.getByLabelText("Seconds")).toBeInTheDocument();
    expect(screen.queryByLabelText("Reps")).toBeNull();
    await openOptions(user);
    expect(segmented("Weight unit")).toBeInTheDocument();
    expect(querySegmented("Distance unit")).toBeNull();
    expect(optionLabels()).not.toContain("Distance unit");
  });
});

describe("18.1 AC40 — feet in the panel", () => {
  it("switching a carry's distance unit to ft relabels the input Distance (ft)", async () => {
    const user = userEvent.setup();
    render(<Entry modality="weight_distance" initial={draftFor("weight_distance")} />);
    await openOptions(user);
    await chooseSegmentValue(user, "Distance unit", "ft", screen);
    expect(screen.getByLabelText("Distance (ft)")).toBeInTheDocument();
  });
  it("distance_duration keeps the plain Distance label (Spec 18.1 D5)", () => {
    render(<Entry modality="distance_duration" initial={draftFor("distance_duration")} />);
    expect(screen.getByLabelText("Distance")).toBeInTheDocument();
  });
  it("SetFields.tsx declares no distance-unit list of its own", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "SetFields.tsx"), "utf8");
    expect(src).not.toMatch(/\[\s*"m"/);
    expect(src).toContain("DISTANCE_UNIT_VALUES");
  });
});

describe("18.1 AC20 — the sheet variant", () => {
  it("calories shows a Calories text field; no stepper", () => {
    render(<SetFields variant="sheet" modality="calories" draft={draftFor("calories", { calories: "20" })} errors={{}} idPrefix="s" onChange={() => {}} />);
    expect(screen.getByLabelText("Calories")).toHaveValue("20");
    expect(screen.getByLabelText("Calories")).toHaveAttribute("inputmode", "numeric");
    expect(screen.queryByRole("button", { name: /calories by/ })).toBeNull();
  });
});
