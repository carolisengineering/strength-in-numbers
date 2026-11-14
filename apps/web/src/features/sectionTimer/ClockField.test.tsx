import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ClockField } from "./ClockField";
import { CLOCK_HINT } from "./timerCopy";

function Harness(props: { onChange?: (d: string) => void; error?: string; hint?: string }) {
  const [digits, setDigits] = useState("");
  return (
    <ClockField
      id="len"
      label="Round length"
      digits={digits}
      error={props.error}
      hint={props.hint}
      onChange={(d) => {
        props.onChange?.(d);
        setDigits(d);
      }}
    />
  );
}

describe("10.7 AC1 — the clock field", () => {
  it("typing 3 4 1 shows 0:03, 0:34, 3:41 and reports the digits", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText("Round length");
    const seen: string[] = [];
    for (const key of "341") {
      await userEvent.type(input, key);
      seen.push((input as HTMLInputElement).value);
    }
    expect(seen).toEqual(["0:03", "0:34", "3:41"]);
    expect(onChange).toHaveBeenLastCalledWith("341");
  });

  it("a sixth key leaves 123:45", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Round length");
    await userEvent.type(input, "123456");
    expect(input).toHaveValue("123:45");
  });

  it("Backspace drops a digit; clearing empties it", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Round length");
    await userEvent.type(input, "341");
    await userEvent.type(input, "{Backspace}");
    expect(input).toHaveValue("0:34");
    await userEvent.clear(input);
    expect(input).toHaveValue("");
  });

  it("pasting 3:41 gives 3:41", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Round length");
    input.focus();
    await userEvent.paste("3:41");
    expect(input).toHaveValue("3:41");
  });
});

describe("10.7 AC3 — field accessibility", () => {
  it("a visible label, the hint and then the error in aria-describedby, numeric input, no autofocus", () => {
    const { rerender } = render(<ClockField id="cap" label="Cap" digits="" onChange={() => {}} />);
    const input = screen.getByLabelText("Cap");
    expect(screen.getByText("Cap")).toBeVisible();
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).not.toHaveFocus();
    expect(input.getAttribute("aria-describedby")).toBe("cap-hint");
    expect(document.getElementById("cap-hint")).toHaveTextContent(CLOCK_HINT);
    rerender(<ClockField id="cap" label="Cap" digits="375" error="Seconds go up to 59." onChange={() => {}} />);
    expect(input.getAttribute("aria-describedby")).toBe("cap-hint cap-error");
  });

  it("a caller's hint is a second sentence after the clock hint", () => {
    render(<ClockField id="cap" label="Cap" hint="Leave empty for For Time, with no cap." digits="" onChange={() => {}} />);
    expect(document.getElementById("cap-hint")).toHaveTextContent(`${CLOCK_HINT} Leave empty for For Time, with no cap.`);
  });
});

describe("17.10 AC13 — a field in a group points at the group's hint", () => {
  it("hint={null} draws no hint of its own; describedBy names the group's", () => {
    render(<ClockField id="r1" label="Round 1" hint={null} describedBy="group-hint" digits="" onChange={() => {}} />);
    expect(document.getElementById("r1-hint")).toBeNull();
    expect(screen.queryByText(CLOCK_HINT)).toBeNull();
    expect(screen.getByLabelText("Round 1").getAttribute("aria-describedby")).toBe("group-hint");
  });

  it("with an error, it names the group's hint and the error", () => {
    render(<ClockField id="r1" label="Round 1" hint={null} describedBy="group-hint" digits="375" error="Seconds go up to 59." onChange={() => {}} />);
    expect(screen.getByLabelText("Round 1").getAttribute("aria-describedby")).toBe("group-hint r1-error");
  });

  it("a lone field keeps its own hint (screenshots 90 and 95 unchanged)", () => {
    render(<ClockField id="cap" label="Cap" digits="" onChange={() => {}} />);
    expect(document.getElementById("cap-hint")).toHaveTextContent(CLOCK_HINT);
    expect(screen.getByLabelText("Cap").getAttribute("aria-describedby")).toBe("cap-hint");
  });
});

describe("10.7 AC1 / minor 315 — pasting a TimerLine clock back", () => {
  it("a pasted 1:30:00 shows 90:00", async () => {
    const user = userEvent.setup();
    function Probe() {
      const [digits, setDigits] = useState("");
      return <ClockField id="c" label="Cap" digits={digits} onChange={setDigits} />;
    }
    render(<Probe />);
    await user.click(screen.getByLabelText("Cap"));
    await user.paste("1:30:00");
    expect(screen.getByLabelText("Cap")).toHaveValue("90:00");
  });
});

describe("minor 537 — a refused keystroke isn't an edit", () => {
  it("a refused sixth digit calls no onChange", async () => {
    const onChange = vi.fn();
    render(<ClockField id="cap" label="Cap" digits="12345" onChange={onChange} />);
    const input = screen.getByLabelText("Cap");
    await userEvent.type(input, "6");
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("123:45");
  });
});
