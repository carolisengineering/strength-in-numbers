import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { chooseSegmentValue, segmentChoice, segmented, segmentOptions } from "../../test/controls";
import { useClearOnEdit } from "../../ui/useClearOnEdit";
import { CAP_MAX_ERROR, FOR_TIME_HINT, SECONDS_MAX_ERROR } from "./timerCopy";
import { fieldsFromTimer, type TimerFieldErrors, type TimerFieldsValue } from "./timerFields";
import { TimerFields } from "./TimerFieldGroup";

function Harness(props: { initial?: TimerFieldsValue; errors?: TimerFieldErrors }) {
  const [value, setValue] = useState(props.initial ?? fieldsFromTimer(null));
  return (
    <>
      <TimerFields idPrefix="t" value={value} errors={props.errors} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
      <button type="button">elsewhere</button>
    </>
  );
}
const valueOf = () => JSON.parse(screen.getByTestId("value").textContent!) as TimerFieldsValue;

describe("minor 313 — onEdit names the field that changed", () => {
  it("typing a round length reports roundSeconds and the group; rounds reports rounds", async () => {
    const user = userEvent.setup();
    const edits: string[] = [];
    function Probe() {
      const [value, setValue] = useState<TimerFieldsValue>({ format: "set_timer", rounds: "", roundDigits: "", capDigits: "" });
      return <TimerFields idPrefix="p" value={value} onChange={setValue} onEdit={(field) => edits.push(field)} />;
    }
    render(<Probe />);
    await user.type(screen.getByLabelText("Round length"), "1");
    expect(edits).toEqual(["roundSeconds", "group"]);
    edits.length = 0;
    await user.type(screen.getByLabelText("Rounds"), "4");
    expect(edits).toEqual(["rounds", "group"]);
  });
});

describe("10.7 AC4 — timer fields", () => {
  it("17.7 AC6 — Timer is a group of four radios: None, Set Timer, AMRAP, Time Cap", () => {
    render(<Harness />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(within(segmented("Timer")).getAllByRole("radio")).toHaveLength(4);
    expect(segmentOptions("Timer")).toEqual(["None", "Set Timer", "AMRAP", "Time Cap"]);
  });

  it("a section with no timer opens on None, with nothing below", () => {
    render(<Harness />);
    expect(segmentChoice("Timer")).toBe("none");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it.each<[string, string[]]>([
    ["set_timer", ["Rounds", "Round length"]],
    ["amrap", ["Time limit"]],
    ["time_cap", ["Cap"]],
  ])("%s shows exactly its fields", async (format, labels) => {
    render(<Harness />);
    await chooseSegmentValue(userEvent, "Timer", format);
    expect(screen.getAllByRole("textbox").map((i) => i.getAttribute("id")).map((id) => document.querySelector(`label[for="${id}"]`)!.textContent)).toEqual(labels);
  });

  it("the Cap field says how to leave it For Time", async () => {
    render(<Harness />);
    await chooseSegmentValue(userEvent, "Timer", "time_cap");
    expect(document.getElementById(screen.getByLabelText("Cap").getAttribute("aria-describedby")!.split(" ")[0]!)).toHaveTextContent(FOR_TIME_HINT);
  });

  it("choosing AMRAP after typing a Set Timer leaves the new field empty", async () => {
    render(<Harness />);
    await chooseSegmentValue(userEvent, "Timer", "set_timer");
    await userEvent.type(screen.getByLabelText("Rounds"), "5");
    await userEvent.type(screen.getByLabelText("Round length"), "500");
    await chooseSegmentValue(userEvent, "Timer", "amrap");
    expect(screen.getByLabelText("Time limit")).toHaveValue("");
    expect(valueOf()).toEqual({ format: "amrap", rounds: "", roundDigits: "", capDigits: "" });
  });

  it("Rounds takes digits only, at most 3", async () => {
    render(<Harness />);
    await chooseSegmentValue(userEvent, "Timer", "set_timer");
    await userEvent.type(screen.getByLabelText("Rounds"), "1a2b34");
    expect(screen.getByLabelText("Rounds")).toHaveValue("123");
  });
});

describe("10.7 AC2 — seconds error", () => {
  it("typing 7 5 1 never shows an alert while focused, and ends at 7:51 with no error", async () => {
    render(<Harness initial={{ ...fieldsFromTimer(null), format: "amrap" }} />);
    const input = screen.getByLabelText("Time limit");
    for (const key of "751") {
      await userEvent.type(input, key);
      expect(screen.queryByRole("alert")).toBeNull();
    }
    expect(input).toHaveValue("7:51");
  });

  it("3 7 5 then blur shows the error with 3:75 kept; a fourth digit that makes it valid clears it", async () => {
    render(<Harness initial={{ ...fieldsFromTimer(null), format: "amrap" }} />);
    const input = screen.getByLabelText("Time limit");
    await userEvent.type(input, "375");
    await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.getByRole("alert")).toHaveTextContent(SECONDS_MAX_ERROR);
    expect(input).toHaveValue("3:75");
    await userEvent.type(input, "1");
    expect(input).toHaveValue("37:51");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an error passed after Done shows without a blur, and clears once the digits are valid", async () => {
    const initial: TimerFieldsValue = { format: "amrap", rounds: "", roundDigits: "", capDigits: "375" };
    render(<Harness initial={initial} errors={{ capSeconds: SECONDS_MAX_ERROR }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(SECONDS_MAX_ERROR);
    await userEvent.type(screen.getByLabelText("Time limit"), "1");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("10.7 AC5 — errors under their fields", () => {
  it("three errors render, each under its own field; a group error under the group", () => {
    const initial: TimerFieldsValue = { format: "set_timer", rounds: "", roundDigits: "", capDigits: "" };
    render(<Harness initial={initial} errors={{ rounds: "Enter the number of rounds.", roundSeconds: "Enter the round length.", group: "Check the timer and try again." }} />);
    expect(screen.getByLabelText("Rounds")).toHaveAccessibleDescription(expect.stringContaining("Enter the number of rounds."));
    expect(screen.getByLabelText("Round length")).toHaveAccessibleDescription(expect.stringContaining("Enter the round length."));
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      "Enter the number of rounds.",
      "Enter the round length.",
      "Check the timer and try again.",
    ]);
  });
});

describe("minor 537 — a refused keystroke keeps the field's message", () => {
  const ERRORS: TimerFieldErrors = { capSeconds: CAP_MAX_ERROR };
  function Sheet() {
    const [value, setValue] = useState<TimerFieldsValue>({ format: "amrap", rounds: "", roundDigits: "", capDigits: "99999" });
    const shown = useClearOnEdit<keyof TimerFieldErrors>(ERRORS);
    return <TimerFields idPrefix="m" value={value} errors={shown.visible} onChange={setValue} onEdit={(field) => shown.edit(field)} />;
  }

  it("a refused sixth digit leaves the message; Backspace, a real edit, hides it (Review Focus 5)", async () => {
    const user = userEvent.setup();
    render(<Sheet />);
    const input = screen.getByLabelText("Time limit");
    expect(screen.getByRole("alert")).toHaveTextContent(CAP_MAX_ERROR);
    await user.type(input, "6");
    expect(input).toHaveValue("999:99");
    expect(screen.getByRole("alert")).toHaveTextContent(CAP_MAX_ERROR);
    await user.type(input, "{Backspace}");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
