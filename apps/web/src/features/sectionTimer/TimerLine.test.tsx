import { describeTimer, scoreText, type SectionScore, type SectionTimer } from "@sin/core";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimerLine } from "./TimerLine";

describe("10.7 AC7 — one line component", () => {
  it.each<[SectionTimer, SectionScore]>([
    [{ format: "set_timer", roundSeconds: 300, rounds: 5 }, { kind: "total_time", seconds: 1062, rounds: 5 }],
    [{ format: "amrap", capSeconds: 720 }, { kind: "rounds_reps", rounds: 5, reps: 7 }],
    [{ format: "time_cap", capSeconds: 900 }, { kind: "finish_time", seconds: 860 }],
    [{ format: "time_cap", capSeconds: null }, { kind: "capped", rounds: 4, reps: 7 }],
  ])("%j", (timer, score) => {
    const { container, rerender } = render(<TimerLine timer={timer} />);
    expect(container.textContent).toBe(describeTimer(timer));
    rerender(<TimerLine timer={timer} score={score} />);
    expect(container.textContent).toBe(`${describeTimer(timer)} · ${scoreText(score)}`);
    rerender(<TimerLine timer={timer} score={null} />);
    expect(container.textContent).toBe(describeTimer(timer));
  });
});
