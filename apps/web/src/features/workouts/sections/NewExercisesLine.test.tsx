import { render } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkoutSection } from "@sin/core";
import { NewExercisesLine } from "./NewExercisesLine";

let n = 0;
const sec = (name: string, position: number, addedInWorkout: boolean): WorkoutSection =>
  ({ id: `00000000-0000-4000-8000-00000000000${(n += 1)}`, position, name, notes: null, addedInWorkout }) as WorkoutSection;

const line = (sections: WorkoutSection[]) => render(<NewExercisesLine sections={sections} />).container;

describe("10.6 AC4 — NewExercisesLine", () => {
  it("no sections → nothing", () => {
    expect(line([]).innerHTML).toBe("");
  });

  it("the last section copied from the routine → nothing", () => {
    expect(line([sec("Warm-up", 0, true), sec("Strength", 1, false)]).innerHTML).toBe("");
  });

  it("the last section added → the line, with the name in <strong>", () => {
    const c = line([sec("Warm-up", 0, false), sec("Cooldown", 1, true)]);
    expect(c.textContent).toBe("New exercises go into Cooldown.");
    expect(c.querySelector("strong")?.textContent).toBe("Cooldown");
  });

  it("the added last section removed, the previous one copied → nothing", () => {
    expect(line([sec("Warm-up", 0, false)]).innerHTML).toBe("");
  });

  it("sections out of position order → the highest position decides", () => {
    expect(line([sec("Late", 3, true), sec("Early", 0, false)]).textContent).toBe("New exercises go into Late.");
    expect(line([sec("Early", 0, true), sec("Late", 3, false)]).innerHTML).toBe("");
  });

  it("a name with markup renders as text", () => {
    const c = line([sec("<img src=x onerror=alert(1)>", 0, true)]);
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("strong")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("10.6 AC4 — one reader of addedInWorkout", () => {
  it("only sections/NewExercisesLine.tsx names addedInWorkout among the web's non-test sources", () => {
    const root = join(__dirname, "../../..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !path.includes(`${join(root, "test")}`)) files.push(path);
      }
    };
    walk(root);
    const readers = files.filter((f) => readFileSync(f, "utf8").includes("addedInWorkout")).map((f) => relative(root, f));
    // The rule itself is @sin/core's sectionForNewExercise; the line is its one caller (it may not even name the field).
    expect(readers.filter((f) => f !== "features/workouts/sections/NewExercisesLine.tsx")).toEqual([]);
    expect(files.filter((f) => readFileSync(f, "utf8").includes("sectionForNewExercise")).map((f) => relative(root, f))).toEqual([
      "features/workouts/sections/NewExercisesLine.tsx",
    ]);
  });
});
