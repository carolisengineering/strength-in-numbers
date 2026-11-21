import { describe, expect, it } from "vitest";
import { readWorkoutText } from "../src/workoutText.js";

const read = (lines: string[]) => readWorkoutText(lines.join("\n"));

describe("10.7 AC46 — minor 597: a bold cap line inside a run times the section", () => {
  // A Time Cap needs a time score (AC45), so each section carries the TIME badge.
  const plain = read(["Main", "TIME", "3 Rounds", "- 12 Minute Cap", "10 Squats"]);
  const bold = read(["Main", "TIME", "3 Rounds", "- **12 Minute Cap**", "10 Squats"]);

  it("- **12 Minute Cap** times the section as the plain line does", () => {
    expect(plain.sections[0]!.timer).toBeDefined();
    expect(bold.sections[0]!.timer).toEqual(plain.sections[0]!.timer);
  });

  it("the bold line still stays in the section's notes", () => {
    expect(bold.sections[0]!.notes).toBe(plain.sections[0]!.notes?.replace("12 Minute Cap", "**12 Minute Cap**"));
  });

  it("an unbulleted bold note line still gives no timer", () => {
    expect(read(["Main", "TIME", "**Note:** rest 2 min", "10 Squats"]).sections[0]!.timer).toBeUndefined();
  });
});
