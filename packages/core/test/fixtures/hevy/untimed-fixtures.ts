import type { HevyMapping, WorkoutDetail } from "../../../src/index.js";
import { detail, exercise, mappingFor, section } from "./workout-detail.js";

/**
 * Spec 09.5 AC26 / AC29(a): untimed workouts whose Hevy body and fingerprint source are frozen in
 * `hevy-untimed-goldens.test.ts` (computed from the code before Phase C). Every section is untimed
 * (the builder's `timer: null, result: null, roundTimes: []`). Tasks 3 and 4 reuse these rows.
 */
export const UNTIMED_FIXTURES: [label: string, d: () => WorkoutDetail, mapping: () => HevyMapping][] = [
  ["no sections", () => detail({ notes: "Felt strong", exercises: [exercise(0), exercise(1, { notes: "slow" })] }), () => mappingFor(3)],
  [
    "Warm-up with a note",
    () => {
      const warm = section(0, "Warm-up", { notes: "Easy" });
      return detail({ sections: [warm], exercises: [exercise(0, { sectionId: warm.id }), exercise(1)] });
    },
    () => mappingFor(3),
  ],
  [
    "Accessory with a note plus an exercise note",
    () => {
      const acc = section(0, "Accessory", { notes: "light" });
      return detail({ sections: [acc], exercises: [exercise(0, { sectionId: acc.id, notes: "ex" }), exercise(1, { sectionId: acc.id })] });
    },
    () => mappingFor(3),
  ],
  [
    "a named section with a note",
    () => {
      const fin = section(0, "Finisher", { notes: "fast" });
      return detail({ sections: [fin], exercises: [exercise(0), exercise(1, { sectionId: fin.id })] });
    },
    () => mappingFor(3),
  ],
  [
    "a named section split into two runs",
    () => {
      const main = section(0, "Main", { notes: "Rx" });
      return detail({
        sections: [main],
        exercises: [exercise(0, { sectionId: main.id }), exercise(1), exercise(2, { sectionId: main.id })],
      });
    },
    () => mappingFor(3),
  ],
  [
    "the markerless mapping with Warm-up and a named section",
    () => {
      const warm = section(0, "Warm-up", { notes: "Easy" });
      const main = section(1, "Main", { notes: "Rx" });
      return detail({
        sections: [warm, main],
        exercises: [exercise(0, { sectionId: warm.id, notes: "ex" }), exercise(1, { sectionId: main.id }), exercise(2, { sectionId: main.id })],
      });
    },
    () => mappingFor(3, { placeholders: false }),
  ],
  [
    "a user rule notes_on_first",
    () => {
      const fin = section(0, "Finisher", { notes: "fast" });
      return detail({ sections: [fin], exercises: [exercise(0, { sectionId: fin.id, notes: "ex" })] });
    },
    () => ({ ...mappingFor(3), sectionRules: [{ name: "Finisher", treatment: "notes_on_first" as const }] }),
  ],
  [
    "an empty section",
    () => {
      const empty = section(0, "Cooldown", { notes: "stretch" });
      return detail({ sections: [empty], exercises: [exercise(0)] });
    },
    () => mappingFor(3),
  ],
  [
    "a superset across a section boundary",
    () => {
      const warm = section(0, "Warm-up");
      return detail({
        sections: [warm],
        exercises: [exercise(0, { sectionId: warm.id, supersetGroup: 1 }), exercise(1, { supersetGroup: 1 })],
      });
    },
    () => mappingFor(3),
  ],
];
