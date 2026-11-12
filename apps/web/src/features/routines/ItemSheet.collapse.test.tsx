import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Modality } from "@sin/core";
import { expectNoAxeViolations } from "../../test/axe";
import { exerciseId } from "../../test/catalogFixtures";
import { openRow, summaryButton, summaryButtons, tabStops } from "../../test/planRowHelpers";
import { ItemSheet } from "./ItemSheet";
import type { DraftItem, DraftSet } from "./routineDraft";

const item = (o: Partial<DraftItem> = {}): DraftItem => ({
  key: "k", exerciseId: exerciseId(1), targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null,
  restSeconds: null, notes: null, supersetGroup: null, weight: null, weightUnit: null, plan: null, sectionKey: null, ...o,
});
const set = (key: string, o: Partial<DraftSet> = {}): DraftSet => ({ key, setType: "working", repsLow: 5, repsHigh: 5, weight: 82.5, weightUnit: "kg", ...o });
/** Two warm-ups and three working sets: not uniform, so the sheet shows "Sets differ". */
const RAMP = [
  set("w1", { setType: "warmup", repsLow: 8, repsHigh: 8, weight: 40 }),
  set("w2", { setType: "warmup", weight: 60 }),
  set("s1"),
  set("s2"),
  set("s3"),
];
const UNIFORM = [set("u1"), set("u2"), set("u3")];

function setup(initial = item(), modality: Modality | null = "weight_reps") {
  const onDone = vi.fn();
  render(<ItemSheet open title="Bench Press" item={initial} onDone={onDone} onClose={vi.fn()} modality={modality} />);
  return { onDone, user: userEvent.setup() };
}
const openGroups = () => screen.queryAllByRole("group", { name: /^Set \d+$/ }).map((g) => g.getAttribute("aria-label"));

describe("17.11 AC12 — which row starts open", () => {
  it("an existing plan opens with every row closed", () => {
    setup(item({ plan: RAMP, targetSets: 5 }));
    expect(summaryButtons()).toHaveLength(5);
    expect(openGroups()).toEqual([]);
  });

  it("a one-set plan opens that set", () => {
    setup(item({ plan: [set("only")], targetSets: 1 }));
    expect(openGroups()).toEqual(["Set 1"]);
  });

  it("Plan each set opens the first row", async () => {
    const { user } = setup(item({ targetSets: 3, targetRepsLow: 5, targetRepsHigh: 5, weight: 80, weightUnit: "kg" }));
    await user.click(screen.getByRole("button", { name: "Plan each set" }));
    expect(openGroups()).toEqual(["Set 1"]);
  });

  it("Back, then Plan each set again, opens the first row even on an item that came with a plan", async () => {
    const { user } = setup(item({ plan: UNIFORM, targetSets: 3 }));
    expect(openGroups()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Back to the quick line" }));
    await user.click(screen.getByRole("button", { name: "Plan each set" }));
    expect(openGroups()).toEqual(["Set 1"]);
  });
});

describe("17.11 AC13 — Back to the quick line and 'Sets differ' are unchanged", () => {
  it("a uniform plan offers Back; a ramp says the sets differ", () => {
    setup(item({ plan: UNIFORM, targetSets: 3 }));
    expect(screen.getByRole("button", { name: "Back to the quick line" })).toBeInTheDocument();
  });
  it("a ramp says why there is no quick line", () => {
    setup(item({ plan: RAMP, targetSets: 5 }));
    expect(screen.getByText("Sets differ, so they can't be shown as one line")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to the quick line" })).toBeNull();
  });
});

describe("17.11 AC15 — a five-set plan is 12 tab stops closed, 18 with one row open", () => {
  it("counts the stops on a weight × reps ramp", async () => {
    const { user } = setup(item({ plan: RAMP, targetSets: 5 }));
    const dialog = screen.getByRole("dialog");
    // Five summaries, the unit group, Add set, Rest, Notes, Close, Cancel, Done.
    expect(tabStops(dialog)).toBe(12);
    await openRow(user, 3);
    // Plus the type group, Reps, Weight, Move up, Move down, Remove.
    expect(tabStops(dialog)).toBe(18);
  });
});

describe("17.11 AC19 — the quick line is unchanged", () => {
  it("draws no summary button; Sets, Reps, Weight and Plan each set are as before", () => {
    setup(item({ targetSets: 3, targetRepsLow: 8, targetRepsHigh: 8 }));
    expect(screen.queryByRole("list", { name: "Planned sets" })).toBeNull();
    expect(screen.queryAllByRole("button", { name: /^\d+ · / })).toEqual([]);
    expect(screen.getByLabelText("Sets")).toHaveValue("3");
    expect(screen.getByLabelText("Reps")).toHaveValue("8");
    expect(screen.getByLabelText("Weight")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Plan each set" })).toBeInTheDocument();
  });
});

describe("17.11 AC20 — axe passes with every row closed and with one open", () => {
  it("closed, then row 2 open", async () => {
    const { user } = setup(item({ plan: RAMP, targetSets: 5 }));
    await expectNoAxeViolations(screen.getByRole("dialog"));
    await openRow(user, 2);
    await expectNoAxeViolations(screen.getByRole("dialog"));
  });
});

describe("17.11 AC12 — a summary tap never submits the sheet", () => {
  it("opening and closing rows does not call onDone; the summary is type=button", async () => {
    const { onDone, user } = setup(item({ plan: RAMP, targetSets: 5 }));
    await user.click(summaryButton(2));
    await user.click(summaryButton(2));
    summaryButton(4).focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onDone).not.toHaveBeenCalled();
    expect(summaryButton(4)).toHaveAttribute("type", "button");
  });
});

describe("17.11 AC12 — typed text that doesn't parse survives a collapse", () => {
  it("'abc' in Reps stays through closing and reopening, shows on the line, and errors only on Done", async () => {
    const { onDone, user } = setup(item({ plan: RAMP, targetSets: 5 }));
    await openRow(user, 3);
    await user.clear(screen.getByLabelText("Set 3 reps"));
    await user.type(screen.getByLabelText("Set 3 reps"), "abc");
    await openRow(user, 4);
    expect(summaryButton(3)).toHaveAccessibleName("3 · Working · abc · 82.5 kg");
    expect(screen.queryByRole("alert")).toBeNull();
    await openRow(user, 3);
    expect(screen.getByLabelText("Set 3 reps")).toHaveValue("abc");
    expect(screen.getByLabelText("Set 3 reps")).not.toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Set 3 reps")).toHaveAttribute("aria-invalid", "true");
  });
});
