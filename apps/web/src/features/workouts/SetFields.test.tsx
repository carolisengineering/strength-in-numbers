import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DISTANCE_UNIT_VALUES, SET_TYPE_VALUES, type Modality } from "@sin/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseSegment, segmented, segmentOptions, segmentValue } from "../../test/controls";
import { SET_TYPE_LABELS } from "./format";
import { SetFields } from "./SetFields";
import { draftFromSet, unitDefaultsFor, type SetDraft } from "./setDraft";

const props = { modality: "distance_duration" as const, draft: draftFromSet(null, unitDefaultsFor("kg"), "k"), errors: {}, onChange: () => {}, idPrefix: "t" };

describe("17.8 AC17 — select on focus", () => {
  afterEach(() => vi.restoreAllMocks());
  const MODALITIES: Modality[] = ["weight_reps", "bodyweight_reps", "weighted_bodyweight", "duration", "distance_duration", "calories", "weight_distance", "weight_duration"];
  for (const variant of ["entry", "sheet"] as const) {
    it.each(MODALITIES)(`${variant}: focusing each text input of %s selects its text once`, (modality) => {
      const select = vi.spyOn(HTMLInputElement.prototype, "select");
      render(<SetFields {...props} modality={modality} variant={variant} exerciseName="X" />);
      const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="text"]')];
      expect(inputs.length).toBeGreaterThan(0);
      for (const input of inputs) {
        select.mockClear();
        input.focus();
        expect(select, input.id).toHaveBeenCalledTimes(1);
      }
    });
  }

  // Amended by minors 462–463: the duration's inputs are `DurationInput` (their labels sit above the frame), which
  // selects on focus as `TextField` did; `TextField` had no other caller and is gone.
  it("SetFields.tsx writes no <input outside DurationInput, and that one selects on focus", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "SetFields.tsx"), "utf8");
    const durationInput = src.slice(src.indexOf("function DurationInput("), src.indexOf("\n}\n", src.indexOf("function DurationInput(")));
    expect(src.split("<input").length - 1).toBe(durationInput.split("<input").length - 1);
    expect(durationInput).toMatch(/onFocus=\{\(e\) => e\.currentTarget\.select\(\)\}/);
  });
});

describe("05.3 AC21 — feet under More (Set options before Spec 17.7)", () => {
  it("sheet: Distance unit lists m, km, mi, ft", () => {
    render(<SetFields exerciseName="X" {...props} variant="sheet" />);
    expect(segmentOptions("Distance unit")).toEqual(["m", "km", "mi", "ft"]);
  });
  it("entry: under More, Distance unit lists m, km, mi, ft", async () => {
    render(<SetFields {...props} variant="entry" exerciseName="X" />);
    await userEvent.click(screen.getByRole("button", { name: /^More set options for / }));
    expect(segmentOptions("Distance unit")).toEqual(["m", "km", "mi", "ft"]);
  });
});

describe("17.7 AC6 — units and set type are Segmented", () => {
  const typeLabels = SET_TYPE_VALUES.map((type) => SET_TYPE_LABELS[type]);

  for (const variant of ["entry", "sheet"] as const) {
    const open = async () => {
      if (variant === "entry") await userEvent.click(screen.getByRole("button", { name: /^More set options for / }));
    };

    it(`${variant}: Set type is four radios in order, Weight unit is kg and lb, and no select is left`, async () => {
      render(<SetFields {...props} modality="weight_reps" variant={variant} exerciseName="X" />);
      await open();
      expect(segmentOptions("Set type")).toEqual(typeLabels);
      expect(segmentValue("Set type")).toBe("Working");
      expect(segmentOptions("Weight unit")).toEqual(["kg", "lb"]);
      expect(segmentValue("Weight unit")).toBe("kg");
      expect(screen.queryByRole("combobox")).toBeNull();
    });

    it(`${variant}: a choice sends the same edit values as the select did`, async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { rerender } = render(<SetFields {...props} modality="weight_reps" onChange={onChange} variant={variant} exerciseName="X" />);
      await open();
      await chooseSegment(user, "Set type", "Drop");
      expect(onChange).toHaveBeenLastCalledWith("setType", "drop");
      await chooseSegment(user, "Weight unit", "lb");
      expect(onChange).toHaveBeenLastCalledWith("weightUnit", "lb");
      rerender(<SetFields {...props} modality="distance_duration" onChange={onChange} variant={variant} exerciseName="X" />);
      if (variant === "entry" && !screen.queryByRole("group", { name: "Distance unit" })) await open();
      await chooseSegment(user, "Distance unit", "mi");
      expect(onChange).toHaveBeenLastCalledWith("distanceUnit", "mi");
      expect(segmentOptions("Distance unit")).toEqual([...DISTANCE_UNIT_VALUES]);
    });

    it(`${variant}: the Failure hint still shows`, async () => {
      render(<SetFields {...props} modality="weight_reps" draft={{ ...props.draft, setType: "failure" }} variant={variant} exerciseName="X" />);
      await open();
      expect(segmented("Set type")).toHaveAccessibleDescription("Couldn't complete a rep? Log 0 reps.");
    });
  }
});

// #203: in the New set sheet a "Required" under Reps dropped the Weight column a line, because the columns were
// bottom-aligned. They are top-aligned now, and the unit sits in the value's own Field under the value, so an error
// goes under both and never pulls the unit away from its value. Spec 17.8 AC16 (amended): the value is a stepper now,
// so its row (− value +) and then its unit strip sit in the Field, and the error comes after both.
describe("#203 — the sheet's fields line up when one shows an error", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "SetFields.module.css"), "utf8");
  const rule = (selector: string) =>
    css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

  it("top-aligns the measure columns, so a taller column never moves its neighbor", () => {
    expect(rule(".measures")).toMatch(/align-items:\s*start/);
  });

  for (const [measure, label, unit, modality] of [
    ["weight", "Weight", "Weight unit", "weight_reps"],
    ["distance", "Distance", "Distance unit", "distance_duration"],
  ] as const) {
    it(`17.7 AC6 — puts the ${measure} value, then its unit, then the error, in the value's one Field`, () => {
      render(<SetFields exerciseName="X" {...props} modality={modality} errors={{ [measure]: "Required" }} variant="sheet" />);
      const input = screen.getByLabelText(label);
      const group = segmented(unit);
      const error = screen.getByRole("alert");
      const row = input.closest("[data-stepper-row]")!;
      expect(group.parentElement).toBe(row.parentElement);
      const order = [input, group, error];
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      const field = input.closest("label")?.parentElement ?? screen.getByText(label, { selector: "label" }).parentElement!;
      expect(field.contains(group)).toBe(true);
      expect(field.contains(error)).toBe(true);
      expect(row.nextElementSibling).toBe(group);
      expect(group.nextElementSibling).toBe(error);
      expect(input).toHaveAttribute("aria-describedby", error.id);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(within(group).queryByRole("alert")).toBeNull();
    });
  }

  it("gives each field its own error under its own control when both are empty", () => {
    render(<SetFields exerciseName="X" {...props} modality="weight_reps" errors={{ weight: "Required", reps: "Required" }} variant="sheet" />);
    const [weightError, repsError] = screen.getAllByRole("alert");
    // Each error is the last thing in its own Field, after the value's row and the unit strip or line.
    const fieldOf = (label: string) => screen.getByLabelText(label).closest("[data-stepper-row]")!.parentElement!;
    expect(fieldOf("Weight").lastElementChild).toBe(weightError);
    expect(fieldOf("Reps").lastElementChild).toBe(repsError);
  });
});

// Spec 17.7 Phase B: the entry panel's Warm-up toggle and More, through a draft held like EntryRow holds it.
function Entry({ modality = "weight_reps", initial = props.draft, onChange }: { modality?: Modality; initial?: SetDraft; onChange?: (field: string, value: string) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <SetFields
      variant="entry"
      exerciseName="Overhead Press"
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
const warmup = () => screen.getByRole("button", { name: "Warm-up for Overhead Press" });
const more = () => screen.getByRole("button", { name: "More set options for Overhead Press" });

describe("17.7 AC12 — Warm-up and More replace Set options", () => {
  it("the panel has a Warm-up and a More button in one row, and no Set options", () => {
    render(<Entry />);
    expect(warmup().parentElement).toBe(more().parentElement);
    expect(screen.queryByRole("button", { name: "Set options" })).toBeNull();
    expect(screen.queryByText("Set options")).toBeNull();
  });
});

describe("17.7 AC13 — the Warm-up toggle", () => {
  it("is pressed exactly when the draft is a warm-up, and each tap is an ordinary setType edit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Entry onChange={onChange} />);
    expect(warmup()).toHaveAttribute("aria-pressed", "false");
    expect(warmup()).toHaveTextContent(/^Warm-up$/);
    expect(warmup().querySelector("svg")).toBeNull();
    await user.click(warmup());
    expect(onChange).toHaveBeenLastCalledWith("setType", "warmup");
    expect(warmup()).toHaveAttribute("aria-pressed", "true");
    expect(warmup().querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    await user.click(warmup());
    expect(onChange).toHaveBeenLastCalledWith("setType", "working");
    expect(warmup()).toHaveAttribute("aria-pressed", "false");
  });

  it("its name starts with its visible text and names the exercise", () => {
    render(<Entry />);
    expect(warmup()).toHaveAccessibleName("Warm-up for Overhead Press");
  });

  it("a Drop or Failure draft is not pressed", () => {
    render(<Entry initial={{ ...props.draft, setType: "drop" }} />);
    expect(warmup()).toHaveAttribute("aria-pressed", "false");
  });
});

describe("17.7 AC15 — More reveals set type and the units", () => {
  it("reads More, is named for the exercise, and its aria-expanded follows", async () => {
    const user = userEvent.setup();
    render(<Entry />);
    expect(more()).toHaveTextContent(/^More$/);
    expect(more()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Set type" })).toBeNull();
    await user.click(more());
    expect(more()).toHaveAttribute("aria-expanded", "true");
    expect(segmentOptions("Set type")).toEqual(SET_TYPE_VALUES.map((type) => SET_TYPE_LABELS[type]));
    expect(segmented("Weight unit")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Distance unit" })).toBeNull();
    await user.click(more());
    expect(more()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Set type" })).toBeNull();
  });

  it("shows Distance unit for a distance modality, and no unit for calories", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Entry modality="distance_duration" />);
    await user.click(more());
    expect(segmented("Distance unit")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Weight unit" })).toBeNull();
    unmount();
    render(<Entry modality="calories" />);
    await user.click(more());
    expect(segmented("Set type")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /unit$/ })).toBeNull();
  });

  it("shows the failure hint when Failure is chosen", async () => {
    const user = userEvent.setup();
    render(<Entry />);
    await user.click(more());
    await chooseSegment(user, "Set type", "Failure");
    expect(screen.getByText("Couldn't complete a rep? Log 0 reps.")).toBeInTheDocument();
  });

  it("the toggle and Set type always agree (D8)", async () => {
    const user = userEvent.setup();
    render(<Entry />);
    await user.click(more());
    await user.click(warmup());
    expect(segmentValue("Set type")).toBe("Warm-up");
    await chooseSegment(user, "Set type", "Drop");
    expect(warmup()).toHaveAttribute("aria-pressed", "false");
    await chooseSegment(user, "Set type", "Warm-up");
    expect(warmup()).toHaveAttribute("aria-pressed", "true");
  });
});

describe("17.7 AC16 — the revealed block scrolls clear of the bar", () => {
  const original = Element.prototype.scrollIntoView;
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  it("scrolls once, nearest and not smooth, when More opens; never on close or on a closed mount", async () => {
    const user = userEvent.setup();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Entry />);
    expect(scroll).not.toHaveBeenCalled();
    await user.click(more());
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(scroll.mock.contexts[0]).toBe(segmented("Set type").parentElement);
    await user.click(more());
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
