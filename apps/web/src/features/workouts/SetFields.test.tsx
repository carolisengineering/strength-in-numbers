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
