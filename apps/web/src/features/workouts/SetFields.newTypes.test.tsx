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

function Entry({ modality, initial, onChange, name = "X" }: { modality: Modality; initial: SetDraft; onChange?: (f: DraftEditField, v: string) => void; name?: string }) {
  const [draft, setDraft] = useState(initial);
  return (
    <SetFields
      variant="entry"
      exerciseName={name}
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

describe("17.8 AC12 — distance steppers", () => {
  const stepButtons = () => [...document.querySelectorAll("[data-stepper-row]")].flatMap((row) => [...row.querySelectorAll(":scope > button")]);

  it("a carry in m steps ±10, named with the unit and the exercise", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Entry modality="weight_distance" name="Farmer Carry" initial={draftFor("weight_distance", { weight: "24", distance: "40" })} onChange={onChange} />);
    const down = screen.getByRole("button", { name: "\u221210 m, decrease distance for Farmer Carry" });
    expect(down).toHaveTextContent(/^\u221210$/);
    expect(screen.getByRole("button", { name: "+10 m, increase distance for Farmer Carry" })).toHaveTextContent(/^\+10$/);
    await user.click(screen.getByRole("button", { name: "+10 m, increase distance for Farmer Carry" }));
    expect(onChange).toHaveBeenCalledWith("distance", "50");
    expect(screen.getByLabelText("Distance (m)")).toHaveValue("50");
  });

  it("a unit change to km in More makes the steps ±0.1", async () => {
    const user = userEvent.setup();
    render(<Entry modality="weight_distance" name="Farmer Carry" initial={draftFor("weight_distance", { distance: "1" })} />);
    await openOptions(user);
    await chooseSegmentValue(user, "Distance unit", "km", screen);
    expect(screen.getByRole("button", { name: "+0.1 km, increase distance for Farmer Carry" })).toHaveTextContent(/^\+0\.1$/);
    expect(screen.getByRole("button", { name: "\u22120.1 km, decrease distance for Farmer Carry" })).toHaveTextContent(/^\u22120\.1$/);
  });

  it("a carry's label names its unit, so the stepper has no unit line or unit group name", async () => {
    const user = userEvent.setup();
    render(<Entry modality="weight_distance" initial={draftFor("weight_distance")} />);
    await openOptions(user);
    await chooseSegmentValue(user, "Distance unit", "ft", screen);
    const input = screen.getByLabelText("Distance (ft)");
    expect(input.closest("[data-stepper-row]")).not.toBeNull();
    expect(screen.queryByRole("group", { name: /^Distance ·/ })).toBeNull();
    expect(stepButtons().map((b) => b.textContent)).toContain("+10");
  });

  it("distance_duration keeps the plain Distance label, with its unit line and group name", () => {
    render(<Entry modality="distance_duration" initial={draftFor("distance_duration")} />);
    expect(screen.getByLabelText("Distance").closest("[data-stepper-row]")).not.toBeNull();
    expect(screen.getByRole("group", { name: "Distance · km" })).toBeInTheDocument();
  });
});

describe("17.8 AC13 — centered figures", () => {
  const css = (file: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), "utf8");
  const rule = (source: string, selector: string) => {
    const at = source.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return source.slice(at, source.indexOf("}", at));
  };
  it("the figure fields and the stepper input are centered", () => {
    expect(rule(css("SetFields.module.css"), ".figureInput")).toMatch(/text-align:\s*center/);
    expect(rule(css("NumberStepper.module.css"), ".row .input")).toMatch(/text-align:\s*center/);
  });

  // Minors 462, 463: the labels moved out of the frame's row, so the buttons center on the figures, and the pair no
  // longer wraps at 320 px (two lines of fields pushed Warm-up and More under the bar on an SE-sized phone).
  it("minors 462, 463 — a duration is a Time group: its row holds only the two inputs, the units sit under them", () => {
    render(<Entry modality="duration" initial={draftFor("duration", { minutes: "1", seconds: "15" })} />);
    const group = screen.getByRole("group", { name: "Time" });
    const minutes = within(group).getByRole("textbox", { name: "Minutes" });
    const seconds = within(group).getByRole("textbox", { name: "Seconds" });
    const row = minutes.closest("[data-stepper-row]") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row).toContainElement(seconds);
    expect([...row.querySelectorAll(":scope > button")].map((b) => b.textContent)).toEqual(["−5 s", "+5 s"]);
    expect(row.textContent).not.toMatch(/Minutes|Seconds|min/);
    expect(minutes).toHaveAttribute("inputmode", "numeric");
    expect(minutes).toHaveAttribute("autocomplete", "off");
    // The units, under the figures and hidden from a screen reader (the inputs' names carry them).
    const units = row.nextElementSibling as HTMLElement;
    expect(units).toHaveAttribute("aria-hidden", "true");
    expect([...units.querySelectorAll("span")].map((u) => u.textContent)).toEqual(["min", "s"]);
    const sheetCss = css("SetFields.module.css");
    expect(rule(sheetCss, ".durationLine")).toMatch(/grid-template-columns:\s*var\(--stepper-size\) minmax\(0, 1fr\) var\(--stepper-size\)/);
    expect(rule(sheetCss, ".durationPair")).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(sheetCss).not.toMatch(/flex-wrap:\s*wrap/);
    // At 320 px each field is 44 px: the stepper input's narrow padding, outranking Field's (two classes), fits "59".
    expect(rule(sheetCss, ".durationPair .figureInput")).toMatch(/padding-inline:\s*var\(--space-1\)/);
    expect(css("../../ui/tokens.css")).not.toMatch(/--duration-field-min-width/);
  });

  it("minor 462 — an error sits under its own field, outside the frame's row, linked to the input", () => {
    const errors = { seconds: "Seconds must be 0–59" };
    render(<SetFields exerciseName="Plank" variant="entry" modality="duration" draft={draftFor("duration", { minutes: "1", seconds: "75" })} errors={errors} idPrefix="d" onChange={() => {}} />);
    const seconds = screen.getByLabelText("Seconds");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Seconds must be 0–59");
    expect(seconds).toHaveAttribute("aria-invalid", "true");
    expect(seconds).toHaveAccessibleDescription("Seconds must be 0–59");
    expect(seconds.closest("[data-stepper-row]")).not.toContainElement(alert);
    expect(screen.getByLabelText("Minutes")).not.toHaveAttribute("aria-invalid");
  });
});

describe("18.1 AC20 — the sheet variant", () => {
  // Amended by Spec 17.8 AC16: the sheet has the same calories stepper as the panel.
  it("calories shows a Calories field, with the calories stepper", () => {
    render(<SetFields exerciseName="X" variant="sheet" modality="calories" draft={draftFor("calories", { calories: "20" })} errors={{}} idPrefix="s" onChange={() => {}} />);
    expect(screen.getByLabelText("Calories")).toHaveValue("20");
    expect(screen.getByLabelText("Calories")).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByRole("button", { name: "+5, increase calories for X" })).toBeInTheDocument();
  });
});
