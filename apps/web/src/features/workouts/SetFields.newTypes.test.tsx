import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DISTANCE_UNIT_VALUES, SET_CALORIES_MAX, type Modality } from "@sin/core";
import { render, screen, within } from "@testing-library/react";
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
const openOptions = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Set options" }));
const optionLabels = () => [...document.querySelectorAll("label")].map((l) => l.textContent);

describe("18.1 AC5 — calories panel", () => {
  it("one Calories · cal stepper with a numeric text input, and no other measure", () => {
    render(<Entry modality="calories" initial={draftFor("calories", { calories: "20" })} />);
    const group = screen.getByRole("group", { name: "Calories · cal" });
    expect(within(group).getByLabelText("Calories")).toHaveAttribute("inputmode", "numeric");
    for (const label of ["Weight", "Reps", "Distance", "Minutes", "Seconds"]) expect(screen.queryByLabelText(label)).toBeNull();
  });
  it("Set options holds only the Set type", async () => {
    const user = userEvent.setup();
    render(<Entry modality="calories" initial={draftFor("calories")} />);
    await openOptions(user);
    expect(screen.getByLabelText("Set type")).toBeInTheDocument();
    expect(screen.queryByLabelText("Weight unit")).toBeNull();
    expect(screen.queryByLabelText("Distance unit")).toBeNull();
  });
  it("+ dispatches an ordinary edit with 25 from 20; + is disabled at the max", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { unmount } = render(<Entry modality="calories" initial={draftFor("calories", { calories: "20" })} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Increase calories by 5" }));
    expect(onChange).toHaveBeenCalledWith("calories", "25");
    expect(screen.getByLabelText("Calories")).toHaveValue("25");
    unmount();
    render(<Entry modality="calories" initial={draftFor("calories", { calories: String(SET_CALORIES_MAX) })} />);
    expect(screen.getByRole("button", { name: "Increase calories by 5" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease calories by 5" })).toBeEnabled();
  });
});

describe("18.1 AC7 — weight + distance panel", () => {
  it("a Weight stepper and a Distance (m) input; no reps", () => {
    render(<Entry modality="weight_distance" initial={draftFor("weight_distance", { weight: "24" })} />);
    expect(screen.getByRole("button", { name: "Increase weight by 2.5 kg" })).toBeInTheDocument();
    expect(screen.getByLabelText("Distance (m)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Reps")).toBeNull();
  });
  it("Set options holds Set type, Weight unit and Distance unit (m, km, mi, ft)", async () => {
    const user = userEvent.setup();
    render(<Entry modality="weight_distance" initial={draftFor("weight_distance")} />);
    await openOptions(user);
    expect(screen.getByLabelText("Set type")).toBeInTheDocument();
    expect(screen.getByLabelText("Weight unit")).toBeInTheDocument();
    const units = [...screen.getByLabelText("Distance unit").querySelectorAll("option")].map((o) => o.value);
    expect(units).toEqual([...DISTANCE_UNIT_VALUES]);
  });
});

describe("18.1 AC8 — weight + duration panel", () => {
  it("a Weight stepper, Minutes and Seconds; no reps; Set options has no Distance unit", async () => {
    const user = userEvent.setup();
    render(<Entry modality="weight_duration" initial={draftFor("weight_duration")} />);
    expect(screen.getByRole("button", { name: "Increase weight by 2.5 kg" })).toBeInTheDocument();
    expect(screen.getByLabelText("Minutes")).toBeInTheDocument();
    expect(screen.getByLabelText("Seconds")).toBeInTheDocument();
    expect(screen.queryByLabelText("Reps")).toBeNull();
    await openOptions(user);
    expect(screen.getByLabelText("Weight unit")).toBeInTheDocument();
    expect(screen.queryByLabelText("Distance unit")).toBeNull();
    expect(optionLabels()).not.toContain("Distance unit");
  });
});

describe("18.1 AC40 — feet in the panel", () => {
  it("switching a carry's distance unit to ft relabels the input Distance (ft)", async () => {
    const user = userEvent.setup();
    render(<Entry modality="weight_distance" initial={draftFor("weight_distance")} />);
    await openOptions(user);
    await user.selectOptions(screen.getByLabelText("Distance unit"), "ft");
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
