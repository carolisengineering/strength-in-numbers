import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoundTime, SectionResult, SectionTimer } from "@sin/core";
import { sheetBody, sheetErrorRegion, sheetRow } from "../../../test/sheetHelpers";
import { makeTimedSection } from "../../../test/workoutFixtures";
import type { TimedSection } from "./resultDraft";
import { ResultSheet } from "./ResultSheet";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const rt = (pairs: [number, number][]): RoundTime[] => pairs.map(([round, seconds]) => ({ round, seconds }));
const section = (timer: SectionTimer, roundTimes: RoundTime[] = [], result: SectionResult | null = null, name = "Main") =>
  makeTimedSection({ name, timer, roundTimes, result }) as TimedSection;

function renderSheet(s: TimedSection) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<ResultSheet open section={s} busy={false} formError={null} onSave={onSave} onCancel={onCancel} />);
  return { onSave, onCancel, user: userEvent.setup(), dialog: within(screen.getByRole("dialog", { name: "Log result" })) };
}

describe("10.7 AC27 — the Log result sheet (component)", () => {
  it("titled Log result, with the section name and its plan line; no field has focus; Next on the first empty round", () => {
    const { dialog } = renderSheet(section(SET5, rt([[1, 221], [2, 218], [3, 210], [4, 234]])));
    expect(dialog.getByText("Main")).toBeInTheDocument();
    expect(dialog.getByText("Set Timer 5 × 5:00 · total 14:43")).toBeInTheDocument();
    expect(document.activeElement === document.body || !screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    const round5 = dialog.getByLabelText("Round 5");
    expect(round5.closest("[data-round]")).toHaveTextContent("Next");
    expect(dialog.getByLabelText("Round 4").closest("[data-round]")).not.toHaveTextContent("Next");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

describe("10.7 AC28–AC30 — bodies", () => {
  it("Set Timer: one field per planned round; Total updates as the lifter types", async () => {
    const { dialog, user } = renderSheet(section(SET5, rt([[1, 221], [2, 218], [3, 210]])));
    expect(dialog.getAllByLabelText(/^Round \d$/)).toHaveLength(5);
    expect(dialog.getByText("Total 10:49")).toBeInTheDocument();
    await user.type(dialog.getByLabelText("Round 4"), "354");
    expect(dialog.getByText("Total 14:43")).toBeInTheDocument();
  });

  it("Set Timer with nothing recorded shows no Total", () => {
    const { dialog } = renderSheet(section(SET5));
    expect(dialog.queryByText(/^Total /)).toBeNull();
  });

  it("AMRAP: Rounds and Reps steppers with named buttons; Add round time appends the next round; the hint", async () => {
    const { dialog, user } = renderSheet(section({ format: "amrap", capSeconds: 720 }, rt([[1, 250], [2, 515]])));
    expect(dialog.getByLabelText("Rounds")).toBeInTheDocument();
    expect(dialog.getByLabelText("Reps")).toBeInTheDocument();
    for (const name of ["+1, increase rounds", "−1, decrease rounds", "+1, increase reps", "−1, decrease reps"]) expect(dialog.getByRole("button", { name })).toBeInTheDocument();
    expect(dialog.getByText("Type the gym clock when each round ended. Type the digits: 341 is 3:41.")).toBeInTheDocument();
    expect(dialog.getByRole("group", { name: "Round ends (optional)" })).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Add round time" }));
    expect(dialog.getByLabelText("Round 3")).toHaveValue("");
    await user.click(dialog.getByRole("button", { name: "+1, increase rounds" }));
    expect(dialog.getByLabelText("Rounds")).toHaveValue("1");
  });

  it("17.8 AC4 — result steppers show −1 / +1 and their names lead with that text", () => {
    const { dialog } = renderSheet(section({ format: "amrap", capSeconds: 720 }));
    expect(dialog.getByRole("button", { name: "−1, decrease rounds" })).toHaveTextContent(/^−1$/);
    expect(dialog.getByRole("button", { name: "+1, increase reps" })).toHaveTextContent(/^\+1$/);
    expect(dialog.getByRole("button", { name: "+1, increase rounds" }).querySelector("svg")).toBeNull();
  });

  it("Time Cap: Finished / Hit the cap; switching to Hit the cap and back empties Finish time", async () => {
    const { dialog, user } = renderSheet(section({ format: "time_cap", capSeconds: 900 }));
    const finished = dialog.getByRole("radio", { name: "Finished" });
    expect(finished).toBeChecked();
    await user.type(dialog.getByLabelText("Finish time"), "1420");
    await user.click(dialog.getByRole("radio", { name: "Hit the cap" }));
    expect(dialog.queryByLabelText("Finish time")).toBeNull();
    expect(dialog.getByLabelText("Rounds")).toBeInTheDocument();
    await user.click(dialog.getByRole("radio", { name: "Finished" }));
    expect(dialog.getByLabelText("Finish time")).toHaveValue("");
  });

  it("For Time shows no radio", () => {
    const { dialog } = renderSheet(section({ format: "time_cap", capSeconds: null }));
    expect(dialog.queryByRole("radio")).toBeNull();
    expect(dialog.getByLabelText("Finish time")).toBeInTheDocument();
  });
});

describe("minor 331 — Next is in the round field's description", () => {
  it("the round to fill hears Next after the clock hint; clearing round 3 moves it there", async () => {
    const { dialog, user } = renderSheet(section(SET5, rt([[1, 221], [2, 439], [3, 649], [4, 883]])));
    const describedBy = (n: number) => dialog.getByLabelText(`Round ${n}`).getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(describedBy(5).at(-1)).toBe("result-round-5-next");
    expect(document.getElementById("result-round-5-next")).toHaveTextContent("Next");
    expect(describedBy(5)[0]).toBe("result-clock-hint");
    await user.clear(dialog.getByLabelText("Round 3"));
    expect(describedBy(3).at(-1)).toBe("result-round-3-next");
    expect(describedBy(5)).not.toContain("result-round-5-next");
  });
});

describe("17.13 AC16 — Finished / Hit the cap is a Segmented strip", () => {
  it("the group is named Result; Hit the cap checks and switches the mode", async () => {
    const { dialog, user } = renderSheet(section({ format: "time_cap", capSeconds: 900 }));
    expect(dialog.getByRole("group", { name: "Result" })).toBeInTheDocument();
    const hitCap = dialog.getByRole("radio", { name: "Hit the cap" });
    await user.click(hitCap);
    expect(hitCap).toBeChecked();
    expect(dialog.queryByLabelText("Finish time")).toBeNull();
    expect(hitCap.closest("fieldset")!.className).toMatch(/fieldset/);
    // The sheet's title already says what this is: the legend is for screen readers only and draws no box.
    expect(hitCap.closest("fieldset")!.querySelector("legend")!.className).not.toMatch(/legend/);
  });
});

describe("10.7 AC31 / AC33 — Save and Clear result (component)", () => {
  it("an invalid row shows its error, focuses that field and saves nothing", async () => {
    const { dialog, user, onSave } = renderSheet(section(SET5));
    await user.type(dialog.getByLabelText("Round 5"), "501");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(dialog.getByText("Longer than the round length.")).toBeInTheDocument();
    expect(dialog.getByLabelText("Round 5")).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("10.7 AC31 / minors PR B — an edit hides only that round's message; the next Save checks again", async () => {
    const { dialog, user, onSave } = renderSheet(section(SET5));
    await user.type(dialog.getByLabelText("Round 4"), "501");
    await user.type(dialog.getByLabelText("Round 5"), "502");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(dialog.getAllByText("Longer than the round length.")).toHaveLength(2);
    await user.type(dialog.getByLabelText("Round 4"), "{Backspace}");
    expect(dialog.getByLabelText("Round 4")).not.toHaveAttribute("aria-invalid", "true");
    expect(dialog.getByLabelText("Round 5")).toHaveAttribute("aria-invalid", "true");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(dialog.getByLabelText("Round 5")).toHaveAttribute("aria-invalid", "true");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("10.7 AC31 / minors PR B — a stepper tap is an edit: it hides the Rounds message", async () => {
    const { dialog, user } = renderSheet(section({ format: "amrap", capSeconds: 720 }));
    await user.type(dialog.getByLabelText("Reps"), "5");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(dialog.getByLabelText("Rounds")).toHaveAttribute("aria-invalid", "true");
    await user.click(dialog.getByRole("button", { name: /increase rounds/i }));
    expect(dialog.getByLabelText("Rounds")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("final review #3 — Clear result is an edit: it hides the cleared fields' messages", async () => {
    const { dialog, user } = renderSheet(section({ format: "time_cap", capSeconds: 900 }, [], { rounds: null, reps: null, finishSeconds: 600, capped: false }));
    await user.clear(dialog.getByLabelText("Finish time"));
    await user.type(dialog.getByLabelText("Finish time"), "1600");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(dialog.getByLabelText("Finish time")).toHaveAttribute("aria-invalid", "true");
    await user.click(dialog.getByRole("button", { name: "Clear result" }));
    expect(dialog.getByLabelText("Finish time")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("a valid Save hands the draft over", async () => {
    const { dialog, user, onSave } = renderSheet(section(SET5));
    await user.type(dialog.getByLabelText("Round 1"), "341");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ rows: expect.arrayContaining([{ round: 1, digits: "341" }]) }));
  });

  it("Clear result shows only with a result and empties the result fields", async () => {
    const { dialog, user } = renderSheet(section({ format: "amrap", capSeconds: 720 }, [], { rounds: 5, reps: 7, finishSeconds: null, capped: false }));
    await user.click(dialog.getByRole("button", { name: "Clear result" }));
    expect(dialog.getByLabelText("Rounds")).toHaveValue("");
    expect(dialog.getByLabelText("Reps")).toHaveValue("");
  });

  it("no Clear result without a result; Cancel calls onCancel", async () => {
    const { dialog, user, onCancel } = renderSheet(section({ format: "amrap", capSeconds: 720 }));
    expect(dialog.queryByRole("button", { name: "Clear result" })).toBeNull();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("a section name with markup is text", () => {
    renderSheet(section(SET5, [], null, "<img src=x onerror=alert(1)>"));
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("17.10 AC13 — the clock hint is said once per group", () => {
  const HINT = "Type the digits: 341 is 3:41.";

  it("a five-round Set Timer shows the hint once, and every round points at it", () => {
    const { dialog } = renderSheet(section(SET5));
    const hints = dialog.getAllByText(HINT);
    expect(hints).toHaveLength(1);
    const hintId = hints[0]!.id;
    expect(hintId).not.toBe("");
    const rounds = dialog.getAllByLabelText(/^Round \d$/);
    expect(rounds).toHaveLength(5);
    for (const round of rounds) expect(round.getAttribute("aria-describedby")?.split(" ")).toContain(hintId);
  });

  it("AMRAP: the round-ends group's hint reads both sentences, once", () => {
    const { dialog } = renderSheet(section({ format: "amrap", capSeconds: 720 }, rt([[1, 250], [2, 515]])));
    const hint = dialog.getByText(`Type the gym clock when each round ended. ${HINT}`);
    expect(dialog.getAllByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").includes(HINT))).toHaveLength(1);
    for (const round of dialog.getAllByLabelText(/^Round \d$/)) expect(round.getAttribute("aria-describedby")?.split(" ")).toContain(hint.id);
  });

  it("a round with an error names the hint and the error", async () => {
    const { dialog, user } = renderSheet(section(SET5));
    await user.type(dialog.getByLabelText("Round 1"), "375");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    const ids = dialog.getByLabelText("Round 1").getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0]!)).toHaveTextContent(HINT);
    expect(document.getElementById(ids[1]!)).toHaveAttribute("role", "alert");
  });

  it("Time Cap's lone Finish time keeps its own hint", () => {
    const { dialog } = renderSheet(section({ format: "time_cap", capSeconds: 900 }));
    expect(dialog.getByLabelText("Finish time").getAttribute("aria-describedby")).toBe("result-finish-hint");
    expect(document.getElementById("result-finish-hint")).toHaveTextContent(HINT);
  });
});

describe("17.10 AC14, AC7, AC3 — the Log result sheet uses the action row", () => {
  it("the row reads Cancel then Save; Add round time stays in the body", () => {
    renderSheet(section({ format: "amrap", capSeconds: 720 }));
    expect(sheetRow().getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel", "Save"]);
    expect(within(sheetBody()).getByRole("button", { name: "Add round time" })).toBeInTheDocument();
    expect(within(sheetBody()).queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("busy: Cancel is aria-disabled and does nothing", async () => {
    const onCancel = vi.fn();
    render(<ResultSheet open section={section(SET5)} busy formError={null} onSave={vi.fn()} onCancel={onCancel} />);
    const cancel = sheetRow().getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(cancel);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("a save failure shows in the row (Review Focus 1)", () => {
    render(<ResultSheet open section={section(SET5)} busy={false} formError="Couldn't save the result." onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(sheetErrorRegion()).toHaveTextContent("Couldn't save the result.");
    expect(within(sheetBody()).queryByRole("alert")).toBeNull();
  });
});
