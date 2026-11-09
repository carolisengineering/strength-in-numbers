import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DISTANCE_UNIT_VALUES, SET_TYPE_VALUES } from "@sin/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { chooseSegment, segmented, segmentOptions, segmentValue } from "../../test/controls";
import { SET_TYPE_LABELS } from "./format";
import { SetFields } from "./SetFields";
import { draftFromSet, unitDefaultsFor } from "./setDraft";

const props = { modality: "distance_duration" as const, draft: draftFromSet(null, unitDefaultsFor("kg"), "k"), errors: {}, onChange: () => {}, idPrefix: "t" };

describe("05.3 AC21 — feet in Set options", () => {
  it("sheet: Distance unit lists m, km, mi, ft", () => {
    render(<SetFields {...props} variant="sheet" />);
    expect(segmentOptions("Distance unit")).toEqual(["m", "km", "mi", "ft"]);
  });
  it("entry: under Set options, Distance unit lists m, km, mi, ft", async () => {
    render(<SetFields {...props} variant="entry" />);
    await userEvent.click(screen.getByRole("button", { name: /Set options/ }));
    expect(segmentOptions("Distance unit")).toEqual(["m", "km", "mi", "ft"]);
  });
});

describe("17.7 AC6 — units and set type are Segmented", () => {
  const typeLabels = SET_TYPE_VALUES.map((type) => SET_TYPE_LABELS[type]);

  for (const variant of ["entry", "sheet"] as const) {
    const open = async () => {
      if (variant === "entry") await userEvent.click(screen.getByRole("button", { name: /Set options/ }));
    };

    it(`${variant}: Set type is four radios in order, Weight unit is kg and lb, and no select is left`, async () => {
      render(<SetFields {...props} modality="weight_reps" variant={variant} />);
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
      const { rerender } = render(<SetFields {...props} modality="weight_reps" onChange={onChange} variant={variant} />);
      await open();
      await chooseSegment(user, "Set type", "Drop");
      expect(onChange).toHaveBeenLastCalledWith("setType", "drop");
      await chooseSegment(user, "Weight unit", "lb");
      expect(onChange).toHaveBeenLastCalledWith("weightUnit", "lb");
      rerender(<SetFields {...props} modality="distance_duration" onChange={onChange} variant={variant} />);
      if (variant === "entry" && !screen.queryByRole("group", { name: "Distance unit" })) await open();
      await chooseSegment(user, "Distance unit", "mi");
      expect(onChange).toHaveBeenLastCalledWith("distanceUnit", "mi");
      expect(segmentOptions("Distance unit")).toEqual([...DISTANCE_UNIT_VALUES]);
    });

    it(`${variant}: the Failure hint still shows`, async () => {
      render(<SetFields {...props} modality="weight_reps" draft={{ ...props.draft, setType: "failure" }} variant={variant} />);
      await open();
      expect(segmented("Set type")).toHaveAccessibleDescription("Couldn't complete a rep? Log 0 reps.");
    });
  }
});

// #203: in the New set sheet a "Required" under Reps dropped the Weight column a line, because the columns were
// bottom-aligned. They are top-aligned now, and the unit sits in the value's own Field under the value, so an error
// goes under both and never pulls the unit away from its value.
describe("#203 — the sheet's fields line up when one shows an error", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "SetFields.module.css"), "utf8");
  const rule = (selector: string) =>
    css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

  it("top-aligns the measure columns, so a taller column never moves its neighbor", () => {
    expect(rule(".measures")).toMatch(/align-items:\s*start/);
    expect(rule(".withUnit")).not.toMatch(/align-items:\s*(flex-)?end/);
  });

  for (const [measure, label, unit, modality] of [
    ["weight", "Weight", "Weight unit", "weight_reps"],
    ["distance", "Distance", "Distance unit", "distance_duration"],
  ] as const) {
    it(`17.7 AC6 — puts the ${measure} value, then its unit, then the error, in the value's one Field`, () => {
      render(<SetFields {...props} modality={modality} errors={{ [measure]: "Required" }} variant="sheet" />);
      const input = screen.getByLabelText(label);
      const group = segmented(unit);
      const error = screen.getByRole("alert");
      expect(group.parentElement).toBe(input.parentElement);
      const order = [input, group, error];
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      const field = input.closest("label")?.parentElement ?? screen.getByText(label, { selector: "label" }).parentElement!;
      expect(field.contains(group)).toBe(true);
      expect(field.contains(error)).toBe(true);
      expect(input.parentElement?.nextElementSibling).toBe(error);
      expect(input).toHaveAttribute("aria-describedby", error.id);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(within(group).queryByRole("alert")).toBeNull();
    });
  }

  it("gives each field its own error under its own control when both are empty", () => {
    render(<SetFields {...props} modality="weight_reps" errors={{ weight: "Required", reps: "Required" }} variant="sheet" />);
    const [weightError, repsError] = screen.getAllByRole("alert");
    expect(screen.getByLabelText("Weight").parentElement?.nextElementSibling).toBe(weightError);
    expect(screen.getByLabelText("Reps").nextElementSibling).toBe(repsError);
  });
});
