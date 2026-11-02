import { describe, expect, it } from "vitest";
import { buildHevyWorkout, exportPairFor, type HevyMapping, type HevyPostWorkout, type WorkoutSection } from "../src/index.js";
import { detail, exercise, exerciseId, identityRoot, mappingFor, pair, section, set } from "./fixtures/hevy/workout-detail.js";

const deps = { rootOf: identityRoot };
function body(d: ReturnType<typeof detail>, mapping: HevyMapping = mappingFor(6)): HevyPostWorkout["workout"] {
  const r = buildHevyWorkout(d, mapping, deps);
  if (!r.ok) throw new Error("expected ok");
  return r.body.workout;
}
const notices = (d: ReturnType<typeof detail>, mapping: HevyMapping = mappingFor(6)) => {
  const r = buildHevyWorkout(d, mapping, deps);
  if (!r.ok) throw new Error("expected ok");
  return r.notices;
};

describe("19.0 AC11 — buildHevyWorkout", () => {
  it("the title falls back from the workout title to the routine name to Workout, with title_fallback", () => {
    expect(body(detail({ title: "Push", routineName: "Upper" })).title).toBe("Push");
    expect(notices(detail({ title: "Push" }))).toEqual([]);
    expect(body(detail({ title: null, routineName: "Upper" })).title).toBe("Upper");
    expect(notices(detail({ title: null, routineName: "Upper" }))).toEqual([{ code: "title_fallback", count: 1 }]);
    expect(body(detail({ title: null, routineName: null })).title).toBe("Workout");
  });

  it("description is the workout notes, or null", () => {
    expect(body(detail({ notes: "Felt strong" })).description).toBe("Felt strong");
    expect(body(detail({ notes: null })).description).toBe(null);
  });

  it("notices aggregate per code; only section_no_placeholder carries names", () => {
    const incomplete = detail({ exercises: [exercise(0, { sets: [set({ reps: null }), set({ setNumber: 2, reps: null })] })] });
    expect(notices(incomplete)).toEqual([{ code: "sets_not_sent", count: 2 }]);
    const warm = section(0, "Warm-up");
    const noMarker = detail({ sections: [warm], exercises: [exercise(0, { sectionId: warm.id })] });
    expect(notices(noMarker, mappingFor(6, { placeholders: false }))).toEqual([{ code: "section_no_placeholder", count: 1, names: ["Warm-up"] }]);
  });

  it("start_time and end_time are the instants as UTC ISO strings", () => {
    const w = body(detail({ startedAt: "2026-10-01T10:00:00.000-05:00", endedAt: "2026-10-01T11:00:00.000-05:00" }));
    expect([w.start_time, w.end_time]).toEqual(["2026-10-01T15:00:00.000Z", "2026-10-01T16:00:00.000Z"]);
  });

  it("is_private is true", () => {
    expect(body(detail()).is_private).toBe(true);
  });

  it("exercises follow position and sets follow setNumber, whatever the array order", () => {
    const d = detail({
      exercises: [
        exercise(1, { sets: [set({ setNumber: 2, reps: 2 }), set({ setNumber: 1, reps: 1 })] }),
        exercise(0, { sets: [set({ reps: 9 })] }),
      ],
    });
    const w = body(d);
    expect(w.exercises.map((e) => e.exercise_template_id)).toEqual(["T0", "T1"]);
    expect(w.exercises[1]!.sets.map((s) => s.reps)).toEqual([1, 2]);
  });

  it("superset groups become 0, 1, 2… in order of first appearance; a group of one is null", () => {
    const groups = [7, 7, null, 3, 3, 9];
    const d = detail({ exercises: groups.map((g, i) => exercise(i, { supersetGroup: g })) });
    expect(body(d).exercises.map((e) => e.superset_id)).toEqual([0, 0, null, 1, 1, null]);
  });

  it("exercise notes copy", () => {
    expect(body(detail({ exercises: [exercise(0, { notes: "Pause reps" })] })).exercises[0]!.notes).toBe("Pause reps");
  });

  it("Warm-up: the warm-up marker, with the section note, just before the section's first exercise", () => {
    const warm = section(0, "Warm-up", { notes: "Easy" });
    const d = detail({ sections: [warm], exercises: [exercise(0), exercise(1, { sectionId: warm.id }), exercise(2, { sectionId: warm.id })] });
    const w = body(d);
    expect(w.exercises.map((e) => e.exercise_template_id)).toEqual(["T0", "WARM", "T1", "T2"]);
    expect(w.exercises[1]).toEqual({ exercise_template_id: "WARM", superset_id: null, notes: "Easy", sets: [] });
  });

  it("Warm-up with no note: the marker's notes are null", () => {
    const warm = section(0, "Warm-up");
    const w = body(detail({ sections: [warm], exercises: [exercise(0, { sectionId: warm.id })] }));
    expect(w.exercises[0]!.notes).toBe(null);
  });

  it("Accessory: no marker; the note goes before the first exercise's notes", () => {
    const acc = section(0, "Accessory", { notes: "Light" });
    const d = detail({ sections: [acc], exercises: [exercise(0, { sectionId: acc.id, notes: "Slow" }), exercise(1, { sectionId: acc.id })] });
    const w = body(d);
    expect(w.exercises.map((e) => e.exercise_template_id)).toEqual(["T0", "T1"]);
    expect(w.exercises[0]!.notes).toBe("Light\n\nSlow");
    const alone = body(detail({ sections: [acc], exercises: [exercise(0, { sectionId: acc.id })] }));
    expect(alone.exercises[0]!.notes).toBe("Light");
  });

  it("another name: a workout marker whose notes are the name, then the note", () => {
    const fin = section(0, "Finisher", { notes: "fast" });
    const w = body(detail({ sections: [fin], exercises: [exercise(0, { sectionId: fin.id })] }));
    expect(w.exercises[0]).toEqual({ exercise_template_id: "WORK", superset_id: null, notes: "Finisher\nfast", sets: [] });
    const bare = section(0, "Finisher");
    expect(body(detail({ sections: [bare], exercises: [exercise(0, { sectionId: bare.id })] })).exercises[0]!.notes).toBe("Finisher");
  });

  it("no marker pair: the name and note go on the first exercise, with section_no_placeholder", () => {
    const fin = section(0, "Finisher", { notes: "fast" });
    const d = detail({ sections: [fin], exercises: [exercise(0, { sectionId: fin.id, notes: "Go" })] });
    const r = buildHevyWorkout(d, mappingFor(6, { placeholders: false }), deps);
    expect(r.ok && r.body.workout.exercises.map((e) => e.notes)).toEqual(["Finisher\nfast\n\nGo"]);
    expect(r.ok && r.notices).toEqual([{ code: "section_no_placeholder", count: 1, names: ["Finisher"] }]);
  });

  it("a markerless section split into two runs is counted and named once (deferred minor 137)", () => {
    const warm = section(0, "Warm-up");
    const d = detail({
      sections: [warm],
      exercises: [exercise(0, { sectionId: warm.id }), exercise(1), exercise(2, { sectionId: warm.id })],
    });
    expect(notices(d, mappingFor(6, { placeholders: false }))).toEqual([{ code: "section_no_placeholder", count: 1, names: ["Warm-up"] }]);
  });

  it("a user rule changes the treatment", () => {
    const fin = section(0, "Finisher", { notes: "fast" });
    const mapping = { ...mappingFor(6), sectionRules: [{ name: "finisher", treatment: "notes_on_first" as const }] };
    const w = body(detail({ sections: [fin], exercises: [exercise(0, { sectionId: fin.id })] }), mapping);
    expect(w.exercises.map((e) => [e.exercise_template_id, e.notes])).toEqual([["T0", "fast"]]);
  });

  it("loose exercises get no marker, and an empty section emits nothing", () => {
    const empty = section(0, "Finisher");
    const w = body(detail({ sections: [empty], exercises: [exercise(0), exercise(1)] }));
    expect(w.exercises.map((e) => e.exercise_template_id)).toEqual(["T0", "T1"]);
  });

  it("an exercise with no export pair: ok false, each unmapped exercise once", () => {
    const d = detail({
      exercises: [exercise(0), exercise(7, { exerciseNameSnapshot: "Echo Bike", modalitySnapshot: "calories" }), exercise(8, { exerciseId: exerciseId(7) as never, exerciseNameSnapshot: "Echo Bike", modalitySnapshot: "calories" })],
    });
    expect(buildHevyWorkout(d, mappingFor(6), deps)).toEqual({ ok: false, unmapped: [{ exerciseId: exerciseId(7), name: "Echo Bike", modality: "calories" }] });
  });

  it("a fork uses its lineage root's export pair through rootOf", () => {
    const fork = exerciseId(40);
    const d = detail({ exercises: [exercise(0, { exerciseId: fork as never })] });
    const rootOf = (id: string) => (id === fork ? exerciseId(0) : id);
    const r = buildHevyWorkout(d, mappingFor(1), { rootOf });
    expect(r.ok && r.body.workout.exercises[0]!.exercise_template_id).toBe("T0");
    expect(exportPairFor(fork, mappingFor(1), rootOf)?.hevyTemplateId).toBe("T0");
  });

  it("final review I1: a stale pair whose Hevy type no longer fits the exercise's type is unmapped, never sent empty", () => {
    // Paired as duration, then retyped to weight_reps while nothing was logged (AC25 keeps the pair).
    const mapping = { pairs: [pair({ hevyTemplateId: "D", hevyType: "duration", exerciseId: exerciseId(0) })], sectionRules: [] };
    const d = detail({ exercises: [exercise(0, { exerciseNameSnapshot: "Plank", modalitySnapshot: "weight_reps" })] });
    expect(buildHevyWorkout(d, mapping, deps)).toEqual({ ok: false, unmapped: [{ exerciseId: exerciseId(0), name: "Plank", modality: "weight_reps" }] });
    expect(exportPairFor(exerciseId(0), mapping, identityRoot, "weight_reps")).toBe(null);
  });

  it("final review I1: a fork whose type differs from its root's pair does not borrow it", () => {
    const fork = exerciseId(40);
    const rootOf = (id: string) => (id === fork ? exerciseId(0) : id);
    const d = detail({ exercises: [exercise(0, { exerciseId: fork as never, exerciseNameSnapshot: "My row", modalitySnapshot: "calories" })] });
    const r = buildHevyWorkout(d, mappingFor(1), { rootOf });
    expect(r).toEqual({ ok: false, unmapped: [{ exerciseId: fork, name: "My row", modality: "calories" }] });
  });

  it("only an exportAs exercise pair is used", () => {
    const mapping = { pairs: [pair({ hevyTemplateId: "A", exportAs: false }), pair({ hevyTemplateId: "B", exportAs: true })], sectionRules: [] };
    expect(exportPairFor(exerciseId(0), mapping, identityRoot)?.hevyTemplateId).toBe("B");
  });
});

describe("19.0 AC12 — pure and total", () => {
  const warm = section(0, "Warm-up", { notes: "Easy" });
  const input = detail({ sections: [warm], exercises: [exercise(0, { sectionId: warm.id, supersetGroup: 1 }), exercise(1, { supersetGroup: 1 })] });

  it("does not mutate its input", () => {
    const before = structuredClone(input);
    buildHevyWorkout(input, mappingFor(2), deps);
    expect(input).toEqual(before);
  });

  it("the same input gives equal output", () => {
    expect(buildHevyWorkout(input, mappingFor(2), deps)).toEqual(buildHevyWorkout(input, mappingFor(2), deps));
  });

  it("Review Focus 5: every set unsendable is ok, with empty sets and the notice", () => {
    const d = detail({
      exercises: [exercise(0, { sets: [set({ setType: "warmup", reps: null }), set({ setNumber: 2, setType: "warmup", weightKg: null, weight: null, weightUnit: null })] })],
    });
    const r = buildHevyWorkout(d, mappingFor(1), deps);
    expect(r.ok && r.body.workout.exercises.map((e) => e.sets)).toEqual([[]]);
    expect(r.ok && r.notices).toEqual([{ code: "sets_not_sent", count: 2 }]);
  });

  it("zero exercises gives an empty list", () => {
    expect(body(detail({ exercises: [] })).exercises).toEqual([]);
  });
});

// Spec 09.5 Phase C — timed sections.
const SET_TIMER_5 = { format: "set_timer", roundSeconds: 300, rounds: 5 } as const;
const FIVE_ROUNDS = [221, 218, 210, 205, 208].map((seconds, i) => ({ round: i + 1, seconds }));
const MAIN_LINE = "Set Timer 5 × 5:00 · 3:41, 3:38, 3:30, 3:25, 3:28 · total 17:42";
const timed = (n: number, name: string, timer: WorkoutSection["timer"], o: Partial<WorkoutSection> = {}) => section(n, name, { timer, ...o });
const noResult = { rounds: null, reps: null, finishSeconds: null, capped: false };

describe("09.5 AC26 — a timed section is the workout placeholder", () => {
  it("a Set Timer with a note and five rounds: name, timer line and note, one duration set, before its first exercise", () => {
    const main = timed(0, "Main", SET_TIMER_5, { notes: "Rx", roundTimes: FIVE_ROUNDS });
    const w = body(detail({ sections: [main], exercises: [exercise(0, { sectionId: main.id })] }));
    expect(w.exercises[0]).toEqual({
      exercise_template_id: "WORK",
      superset_id: null,
      notes: `Main\n${MAIN_LINE}\nRx`,
      sets: [{ type: "normal", duration_seconds: 1062 }],
    });
    expect(w.exercises[1]!.exercise_template_id).toBe("T0");
  });

  it("no section note: no third line", () => {
    const main = timed(0, "Main", SET_TIMER_5, { roundTimes: FIVE_ROUNDS });
    expect(body(detail({ sections: [main], exercises: [exercise(0, { sectionId: main.id })] })).exercises[0]!.notes).toBe(`Main\n${MAIN_LINE}`);
  });

  it("a timed Warm-up is WORK (not WARM), with its name line", () => {
    const warm = timed(0, "Warm-up", { format: "amrap", capSeconds: 300 }, { notes: "Easy" });
    const w = body(detail({ sections: [warm], exercises: [exercise(0, { sectionId: warm.id })] }));
    expect(w.exercises[0]).toEqual({
      exercise_template_id: "WORK",
      superset_id: null,
      notes: "Warm-up\nAMRAP 5:00\nEasy",
      sets: [{ type: "normal", duration_seconds: 300 }],
    });
  });

  it("a timed Accessory is WORK, and the first exercise's own notes are unchanged", () => {
    const acc = timed(0, "Accessory", { format: "amrap", capSeconds: 720 }, { notes: "light" });
    const w = body(detail({ sections: [acc], exercises: [exercise(0, { sectionId: acc.id, notes: "ex" })] }));
    expect(w.exercises[0]!.exercise_template_id).toBe("WORK");
    expect(w.exercises[0]!.notes).toBe("Accessory\nAMRAP 12:00\nlight");
    expect(w.exercises[1]!.notes).toBe("ex");
  });

  it("a notes_on_first user rule does not apply to a timed section", () => {
    const main = timed(0, "Main", SET_TIMER_5, { notes: "Rx", roundTimes: FIVE_ROUNDS });
    const mapping = { ...mappingFor(6), sectionRules: [{ name: "Main", treatment: "notes_on_first" as const }] };
    const w = body(detail({ sections: [main], exercises: [exercise(0, { sectionId: main.id })] }), mapping);
    expect(w.exercises[0]!.exercise_template_id).toBe("WORK");
    expect(w.exercises[1]!.notes).toBe(null);
  });

  it("nothing recorded on a Set Timer sends no set; an AMRAP with no result sends its cap", () => {
    const st = timed(0, "Main", SET_TIMER_5);
    expect(body(detail({ sections: [st], exercises: [exercise(0, { sectionId: st.id })] })).exercises[0]!.sets).toEqual([]);
    const am = timed(0, "Finisher", { format: "amrap", capSeconds: 720 });
    expect(body(detail({ sections: [am], exercises: [exercise(0, { sectionId: am.id })] })).exercises[0]!.sets).toEqual([
      { type: "normal", duration_seconds: 720 },
    ]);
  });

  it("a capped Time Cap sends the cap (O1)", () => {
    const tc = timed(0, "Finisher", { format: "time_cap", capSeconds: 900 }, { result: { ...noResult, rounds: 4, reps: 7, capped: true } });
    const w = body(detail({ sections: [tc], exercises: [exercise(0, { sectionId: tc.id })] }));
    expect(w.exercises[0]!.sets).toEqual([{ type: "normal", duration_seconds: 900 }]);
    expect(w.exercises[0]!.notes).toBe("Finisher\nTime Cap 15:00 · Capped · 4 rounds + 7 reps");
  });

  it("a timed section in two runs: two WORK markers with the same notes, only the first carries the duration", () => {
    const main = timed(0, "Main", SET_TIMER_5, { notes: "Rx", roundTimes: FIVE_ROUNDS });
    const w = body(detail({ sections: [main], exercises: [exercise(0, { sectionId: main.id }), exercise(1), exercise(2, { sectionId: main.id })] }));
    expect(w.exercises.map((e) => e.exercise_template_id)).toEqual(["WORK", "T0", "T1", "WORK", "T2"]);
    expect(w.exercises[0]!.notes).toBe(`Main\n${MAIN_LINE}\nRx`);
    expect(w.exercises[3]!.notes).toBe(w.exercises[0]!.notes);
    expect(w.exercises[0]!.sets).toEqual([{ type: "normal", duration_seconds: 1062 }]);
    expect(w.exercises[3]!.sets).toEqual([]);
  });
});

describe("09.5 AC26 / D16 — an empty timed section emits nothing", () => {
  it("a Time Cap section with a result and no exercises leaves the body as without it", () => {
    const tc = timed(1, "Finisher", { format: "time_cap", capSeconds: 900 }, { result: { ...noResult, finishSeconds: 860 } });
    const exercises = () => [exercise(0), exercise(1)];
    expect(body(detail({ sections: [tc], exercises: exercises() })).exercises).toEqual(body(detail({ exercises: exercises() })).exercises);
  });
});

describe("09.5 AC27 — no placeholder pair", () => {
  const main = timed(0, "Main", SET_TIMER_5, { notes: "Rx", roundTimes: FIVE_ROUNDS });
  const d = () =>
    detail({
      sections: [main],
      exercises: [exercise(0, { sectionId: main.id, notes: "ex" }), exercise(1), exercise(2, { sectionId: main.id })],
    });
  const markerless = mappingFor(3, { placeholders: false });

  it("the name, timer line and note go on the first exercise of each run, before its own notes", () => {
    const w = body(d(), markerless);
    expect(w.exercises[0]!.notes).toBe(`Main\n${MAIN_LINE}\nRx\n\nex`);
    expect(w.exercises[2]!.notes).toBe(`Main\n${MAIN_LINE}\nRx`);
  });

  it("no exercise carries a duration set", () => {
    const w = body(d(), markerless);
    expect(w.exercises.flatMap((e) => e.sets).some((s) => "duration_seconds" in s && s.duration_seconds !== undefined)).toBe(false);
  });

  it("section_no_placeholder is counted once over two runs", () => {
    expect(notices(d(), markerless)).toEqual([{ code: "section_no_placeholder", count: 1, names: ["Main"] }]);
  });
});
