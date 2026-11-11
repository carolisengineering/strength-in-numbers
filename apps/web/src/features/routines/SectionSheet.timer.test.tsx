import { render, screen, within } from "@testing-library/react";
import { chooseSegmentValue, segmentChoice } from "../../test/controls";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sheetBody, sheetRow } from "../../test/sheetHelpers";
import { ENTER_ROUND_LENGTH, ENTER_ROUNDS } from "../sectionTimer/timerCopy";
import type { DraftSection } from "./routineDraft";
import { SectionHeader } from "./SectionHeader";
import { SectionSheet } from "./SectionSheet";

const section: DraftSection = { key: "M", name: "Main", notes: "Rx", timer: null };
const sheet = (props: Partial<Parameters<typeof SectionSheet>[0]> = {}) => {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(<SectionSheet open section={section} onDone={onDone} onClose={onClose} {...props} />);
  return { onDone, onClose, dialog: screen.getByRole("dialog", { name: "Edit section" }) };
};

describe("10.7 AC9 — the routine section sheet", () => {
  it("the Timer group sits under Note", () => {
    const { dialog } = sheet();
    // Spec 17.7: the Timer choice is a Segmented, named by its legend; its options are labels of their own.
    const labels = [...dialog.querySelectorAll(":scope label:not(fieldset label), legend")].map((l) => l.textContent);
    expect(labels).toEqual(["Name", "Note", "Timer"]);
  });

  it("Done with an invalid timer shows every error, keeps name and note, and commits nothing", async () => {
    const user = userEvent.setup();
    const { dialog, onDone } = sheet();
    await chooseSegmentValue(user, "Timer", "set_timer", within(dialog));
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Main lift");
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(onDone).not.toHaveBeenCalled();
    expect(within(dialog).getAllByRole("alert").map((a) => a.textContent)).toEqual([ENTER_ROUNDS, ENTER_ROUND_LENGTH]);
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Main lift");
    expect(within(dialog).getByLabelText("Note")).toHaveValue("Rx");
  });

  it("Done with a valid timer commits name, note and timer once", async () => {
    const user = userEvent.setup();
    const { dialog, onDone } = sheet();
    await chooseSegmentValue(user, "Timer", "set_timer", within(dialog));
    await user.type(within(dialog).getByLabelText("Rounds"), "5");
    await user.type(within(dialog).getByLabelText("Round length"), "500");
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("Main", "Rx", { format: "set_timer", roundSeconds: 300, rounds: 5 });
  });

  it("a timed section opens on its format and numbers; None commits null", async () => {
    const user = userEvent.setup();
    const { dialog, onDone } = sheet({ section: { ...section, timer: { format: "time_cap", capSeconds: null } } });
    expect(segmentChoice("Timer", within(dialog))).toBe("time_cap");
    expect(within(dialog).getByLabelText("Cap")).toHaveValue("");
    await chooseSegmentValue(user, "Timer", "none", within(dialog));
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledWith("Main", "Rx", null);
  });

  it("server messages show under their timer fields when the sheet opens", () => {
    const { dialog } = sheet({ section: { ...section, timer: { format: "amrap", capSeconds: 720 } }, messages: { timer: { capSeconds: "Keep it to 180:00 or less." } } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Keep it to 180:00 or less.");
  });

  it("Close calls onClose and commits nothing", async () => {
    const user = userEvent.setup();
    const { dialog, onDone, onClose } = sheet();
    await chooseSegmentValue(user, "Timer", "amrap", within(dialog));
    await user.click(within(dialog).getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("10.7 AC58 — text as text", () => {
  it("a timed section named like markup renders as text in its header", () => {
    const name = "<img src=x onerror=alert(1)>";
    render(
      <SectionHeader
        name={name}
        notes=""
        timer={{ format: "amrap", capSeconds: 720 }}
        index={0}
        count={1}
        headingId="h"
        error={null}
        errorId="e"
        registerMain={() => {}}
        onOpen={() => {}}
        onMoveUp={() => {}}
        onMoveDown={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("10.7 AC4 — a new format starts clean", () => {
  it("after a failed Done, switching format drops the old format's errors", async () => {
    const user = userEvent.setup();
    const { dialog, onDone } = sheet();
    await chooseSegmentValue(user, "Timer", "amrap", within(dialog));
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Enter the time limit.");
    await chooseSegmentValue(user, "Timer", "time_cap", within(dialog));
    expect(within(dialog).queryByRole("alert")).toBeNull();
    await chooseSegmentValue(user, "Timer", "none", within(dialog));
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a server group error goes once None is chosen", async () => {
    const user = userEvent.setup();
    const { dialog } = sheet({ section: { ...section, timer: { format: "amrap", capSeconds: 720 } }, messages: { timer: { group: "Check the timer and try again." } } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Check the timer and try again.");
    await chooseSegmentValue(user, "Timer", "none", within(dialog));
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });
});

describe("17.10 AC14, AC7 — the routine section sheet uses the action row", () => {
  it("the row holds Cancel then Done; Done submits once", async () => {
    const user = userEvent.setup();
    const { onDone } = sheet();
    expect(sheetRow().getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel", "Done"]);
    expect(within(sheetBody()).queryByRole("button", { name: "Done" })).toBeNull();
    await user.click(sheetRow().getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("Cancel calls onClose and commits nothing", async () => {
    const user = userEvent.setup();
    const { onDone, onClose } = sheet();
    await user.click(sheetRow().getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});
