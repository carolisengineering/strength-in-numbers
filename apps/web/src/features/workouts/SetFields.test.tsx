import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SetFields } from "./SetFields";
import { draftFromSet, unitDefaultsFor } from "./setDraft";

const options = () =>
  [...screen.getByRole("combobox", { name: "Distance unit" }).querySelectorAll("option")].map((o) => o.value);
const props = { modality: "distance_duration" as const, draft: draftFromSet(null, unitDefaultsFor("kg"), "k"), errors: {}, onChange: () => {}, idPrefix: "t" };

describe("05.3 AC21 — feet in Set options", () => {
  it("sheet: the distance-unit select lists m, km, mi, ft", () => {
    render(<SetFields {...props} variant="sheet" />);
    expect(options()).toEqual(["m", "km", "mi", "ft"]);
  });
  it("entry: under Set options, the distance-unit select lists m, km, mi, ft", async () => {
    render(<SetFields {...props} variant="entry" />);
    await userEvent.click(screen.getByRole("button", { name: /Set options/ }));
    expect(options()).toEqual(["m", "km", "mi", "ft"]);
  });
});

// #203: in the New set sheet a "Required" under Reps dropped the Weight column a line, because the columns were
// bottom-aligned. They are top-aligned now, and the unit select sits in the value's own row, so an error goes under
// both and never pulls the select away from its value.
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
    it(`puts the ${measure} value and its unit in one row, with the error under the row`, () => {
      render(<SetFields {...props} modality={modality} errors={{ [measure]: "Required" }} variant="sheet" />);
      const input = screen.getByLabelText(label);
      const select = screen.getByRole("combobox", { name: unit });
      expect(select.parentElement).toBe(input.parentElement);
      const error = screen.getByRole("alert");
      expect(input.parentElement?.nextElementSibling).toBe(error);
      expect(input).toHaveAttribute("aria-describedby", error.id);
      expect(input).toHaveAttribute("aria-invalid", "true");
    });
  }

  it("gives each field its own error under its own control when both are empty", () => {
    render(<SetFields {...props} modality="weight_reps" errors={{ weight: "Required", reps: "Required" }} variant="sheet" />);
    const [weightError, repsError] = screen.getAllByRole("alert");
    expect(screen.getByLabelText("Weight").parentElement?.nextElementSibling).toBe(weightError);
    expect(screen.getByLabelText("Reps").nextElementSibling).toBe(repsError);
  });
});
