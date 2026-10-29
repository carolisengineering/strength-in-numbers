import { describe, expect, it } from "vitest";
import { translateHevyWorkout, type HevyWorkoutTranslation } from "../src/index.js";
import { fixture, hex, hset, hworkout, importContext, sinId } from "./fixtures/hevy/import/context.js";

const ctx = importContext();
const bench = (n = 1) => hex("BENCH", Array.from({ length: n }, () => hset({ weightKg: 60, reps: 5 })));

function created(t: HevyWorkoutTranslation) {
  if (t.outcome !== "create") throw new Error(`expected create, got ${t.outcome}`);
  return t;
}
const count = (list: { code: string; count: number }[], code: string) => list.find((c) => c.code === code)?.count ?? 0;

describe("19.1 AC4 — precedence: time_invalid, then unpaired, then the rest", () => {
  it("bad times plus an unpaired exercise is time_invalid", () => {
    const w = hworkout([hex("UNKNOWN", [hset({ reps: 1 })])], { endTime: "2026-10-01T09:00:00Z" });
    expect(translateHevyWorkout(w, ctx)).toEqual({ outcome: "time_invalid" });
  });

  it("an unpaired exercise plus a placeholder-only remainder is unpaired, not no_usable_sets", () => {
    const w = hworkout([hex("WARMUP", [hset({ reps: 1 })]), hex("UNKNOWN", [hset({ reps: 1 })])]);
    expect(translateHevyWorkout(w, ctx)).toEqual({ outcome: "unpaired", unpaired: ["UNKNOWN"] });
  });
});

describe("19.1 AC4 — unpaired[]", () => {
  it("lists a missing pair, a retired exercise and an exercise absent from the context", () => {
    const w = hworkout([bench(), hex("UNKNOWN", []), hex("RETIRED", [hset({ weightKg: 1, reps: 1 })]), hex("ORPHAN", [])]);
    expect(translateHevyWorkout(w, ctx)).toEqual({ outcome: "unpaired", unpaired: ["UNKNOWN", "RETIRED", "ORPHAN"] });
  });

  it("each template id appears once, in first-seen order", () => {
    const w = hworkout([hex("ORPHAN", []), bench(), hex("UNKNOWN", []), hex("ORPHAN", []), hex("UNKNOWN", [])]);
    expect(translateHevyWorkout(w, ctx)).toEqual({ outcome: "unpaired", unpaired: ["ORPHAN", "UNKNOWN"] });
  });

  it("an exercise pair with no Hevy type is unpaired", () => {
    const c = importContext();
    const pairs = new Map(c.pairs);
    pairs.set("BENCH", { ...pairs.get("BENCH")!, hevyType: null });
    expect(translateHevyWorkout(hworkout([bench()]), { ...c, pairs })).toEqual({ outcome: "unpaired", unpaired: ["BENCH"] });
  });
});

describe("19.1 AC4 — skips and empty exercises", () => {
  it("a skip pair's sets are dropped as exercise_skipped and the exercise is not stored", () => {
    const t = created(translateHevyWorkout(hworkout([hex("SKIP", [hset(), hset(), hset()]), bench()]), ctx));
    expect(count(t.drops, "exercise_skipped")).toBe(3);
    expect(t.workout.exercises.map((e) => e.exerciseId)).toEqual([sinId(1)]);
  });

  it("an exercise whose every set drops is exercise_no_sets and is not stored", () => {
    const t = created(translateHevyWorkout(hworkout([hex("SQUAT", [hset({ weightKg: 100 })]), bench()]), ctx));
    expect(count(t.drops, "exercise_no_sets")).toBe(1);
    expect(t.workout.exercises).toHaveLength(1);
  });

  it("an exercise with no sets at all is exercise_no_sets", () => {
    const t = created(translateHevyWorkout(hworkout([hex("SQUAT", []), bench()]), ctx));
    expect(count(t.drops, "exercise_no_sets")).toBe(1);
  });
});

describe("19.1 AC4 — stored exercises", () => {
  it("carry the SIN exercise's id, name and modality as snapshots", () => {
    const t = created(translateHevyWorkout(hworkout([bench(), hex("CARRY", [hset({ weightKg: 24, distanceMeters: 40 })])]), ctx));
    expect(t.workout.exercises.map((e) => [e.exerciseId, e.nameSnapshot, e.modalitySnapshot])).toEqual([
      [sinId(1), "Bench Press", "weight_reps"],
      [sinId(6), "Farmer Carry", "weight_distance"],
    ]);
  });

  it("notes are cleaned and cut to the exercise-notes limit with notes_trimmed", () => {
    const t = created(translateHevyWorkout(hworkout([hex("BENCH", bench().sets, { notes: `x\u0000${"n".repeat(4001)}` })]), ctx));
    expect(t.workout.exercises[0]!.notes).toHaveLength(4000);
    expect(t.workout.exercises[0]!.notes!.startsWith("xn")).toBe(true);
    expect(count(t.notices, "notes_trimmed")).toBe(1);
  });

  it("rootIds are the distinct lineage roots of stored exercises (a fork reads as its root)", () => {
    const w = hworkout([bench(), hex("BENCH_FORK", bench().sets), hex("SQUAT", bench().sets), hex("SKIP", [hset()])]);
    expect(created(translateHevyWorkout(w, ctx)).workout.rootIds).toEqual([sinId(1), sinId(2)]);
  });

  it("the title and description become title and notes", () => {
    const t = created(translateHevyWorkout(hworkout([bench()], { title: "  Push  ", description: "felt good\n" }), ctx));
    expect([t.workout.title, t.workout.notes]).toEqual(["Push", "felt good"]);
    expect(t.notices).toEqual([]);
  });

  it("a title over 120 is title_trimmed; a blank title is null without a notice", () => {
    const long = created(translateHevyWorkout(hworkout([bench()], { title: "t".repeat(121) }), ctx));
    expect([long.workout.title!.length, count(long.notices, "title_trimmed")]).toEqual([120, 1]);
    const blank = created(translateHevyWorkout(hworkout([bench()], { title: " \u0001 " }), ctx));
    expect([blank.workout.title, blank.notices]).toEqual([null, []]);
  });

  it("a description over 4000 is notes_trimmed", () => {
    const t = created(translateHevyWorkout(hworkout([bench()], { description: "d".repeat(4001) }), ctx));
    expect([t.workout.notes!.length, count(t.notices, "notes_trimmed")]).toEqual([4000, 1]);
  });

  it("the times, local date and offset are the request's", () => {
    const t = created(translateHevyWorkout(hworkout([bench()], { startTime: "2026-10-01T03:30:00Z", tzOffsetMinutes: -300 }), ctx));
    expect([t.workout.startedAt, t.workout.endedAt, t.workout.localDate, t.workout.tzOffsetMinutes]).toEqual([
      "2026-10-01T03:30:00.000Z",
      "2026-10-01T11:00:00.000Z",
      "2026-09-30",
      -300,
    ]);
  });
});

describe("19.1 AC5 — sets", () => {
  it("each hevySetToSin failure maps to its drop code", () => {
    const w = hworkout([
      hex("BENCH", [hset({ weightKg: 60 }), hset({ weightKg: 60, reps: 5 })]),
      hex("PULLUP", [hset({ weightKg: 10, reps: 5 }), hset({ reps: 8 })]),
      hex("SQUAT", [hset({ weightKg: 60, reps: 1.5 }), hset({ weightKg: 60, reps: 3 })]),
    ]);
    expect(created(translateHevyWorkout(w, ctx)).drops).toEqual([
      { code: "set_missing_measure", count: 1 },
      { code: "set_forbidden_measure", count: 1 },
      { code: "set_out_of_range", count: 1 },
    ]);
  });

  it("ignored values become custom_metric_ignored and assist_weight_ignored, counted per set", () => {
    const w = hworkout([
      hex("BENCH", [hset({ weightKg: 60, reps: 5, customMetric: 2 }), hset({ weightKg: 60, reps: 5, customMetric: 1 })]),
      hex("ASSIST", [hset({ weightKg: 20, reps: 8 }), hset({ weightKg: 0, reps: 8 })]),
    ]);
    expect(created(translateHevyWorkout(w, ctx)).notices).toEqual([
      { code: "custom_metric_ignored", count: 2 },
      { code: "assist_weight_ignored", count: 1 },
    ]);
  });

  it("kept sets are numbered 1, 2, 3 in order, complete, with types mapped", () => {
    const w = hworkout([
      hex("BENCH", [
        hset({ type: "warmup", weightKg: 40, reps: 10 }),
        hset({ weightKg: 60 }),
        hset({ weightKg: 60, reps: 5, rpe: 8 }),
        hset({ type: "dropset", weightKg: 50, reps: 8 }),
      ]),
    ]);
    const sets = created(translateHevyWorkout(w, ctx)).workout.exercises[0]!.sets;
    expect(sets.map((s) => [s.setNumber, s.setType, s.weight, s.reps, s.rpe, s.isComplete])).toEqual([
      [1, "warmup", 40, 10, null, true],
      [2, "working", 60, 5, 8, true],
      [3, "drop", 50, 8, null, true],
    ]);
  });
});

describe("19.1 AC5 — an RPE SIN cannot store is not kept", () => {
  it("an RPE outside 1–10 or not in tenths becomes null; the set is kept", () => {
    const rpes = [100, 11, 0, -3, 7.25, 0.5, 1, 6.5, 8, 9.9, 10];
    const w = hworkout([hex("BENCH", rpes.map((rpe) => hset({ weightKg: 60, reps: 5, rpe })))]);
    const sets = created(translateHevyWorkout(w, ctx)).workout.exercises[0]!.sets;
    expect(sets.map((s) => s.rpe)).toEqual([null, null, null, null, null, null, 1, 6.5, 8, 9.9, 10]);
  });
});

describe("19.1 AC6 — no usable sets", () => {
  it("a placeholder-only workout is no_usable_sets", () => {
    const t = translateHevyWorkout(fixture("placeholder-only"), ctx);
    expect(t.outcome).toBe("no_usable_sets");
  });

  it("an empty workout is no_usable_sets", () => {
    expect(translateHevyWorkout(fixture("empty"), ctx)).toEqual({ outcome: "no_usable_sets", drops: [], notices: [] });
  });

  it("an all-skip workout is no_usable_sets and says why", () => {
    const t = translateHevyWorkout(hworkout([hex("SKIP", [hset(), hset()])]), ctx);
    expect(t).toEqual({ outcome: "no_usable_sets", drops: [{ code: "exercise_skipped", count: 2 }], notices: [] });
  });

  it("a workout whose every set dropped is no_usable_sets", () => {
    const t = translateHevyWorkout(hworkout([hex("SQUAT", [hset({ weightKg: 100 })])]), ctx);
    expect(t).toEqual({
      outcome: "no_usable_sets",
      drops: [
        { code: "exercise_no_sets", count: 1 },
        { code: "set_missing_measure", count: 1 },
      ],
      notices: [],
    });
  });
});

describe("19.1 AC9 — units", () => {
  const w = hworkout([bench(0), hex("BENCH", [hset({ weightKg: 61.235, reps: 5 })])]);

  it("a kg user stores kg to 0.1; a lb user stores lb to 0.1", () => {
    const kg = created(translateHevyWorkout(w, importContext("kg"))).workout.exercises[0]!.sets[0]!;
    const lb = created(translateHevyWorkout(w, importContext("lb"))).workout.exercises[0]!.sets[0]!;
    expect([kg.weight, kg.weightUnit, lb.weight, lb.weightUnit]).toEqual([61.2, "kg", 135, "lb"]);
  });

  it("a distance is in meters", () => {
    const s = created(translateHevyWorkout(fixture("carry"), ctx)).workout.exercises[0]!.sets;
    expect(s.map((x) => [x.distance, x.distanceUnit, x.weight])).toEqual([
      [40, "m", 24],
      [20.5, "m", 32],
    ]);
  });

  it("two calls with equal inputs give deep-equal results", () => {
    const f = fixture("every-drop");
    expect(translateHevyWorkout(f, importContext())).toEqual(translateHevyWorkout(structuredClone(f), importContext()));
  });

  it("a calories exercise read through calories_as_reps stores calories, not reps", () => {
    const s = created(translateHevyWorkout(fixture("calories"), ctx)).workout.exercises[0]!;
    expect(s.modalitySnapshot).toBe("calories");
    expect(s.sets.map((x) => [x.calories, x.reps, x.rpe])).toEqual([
      [20, null, null],
      [15, null, 8],
    ]);
  });

  it("an assisted exercise keeps the reps and drops the assist", () => {
    const t = created(translateHevyWorkout(fixture("assisted"), ctx));
    expect(t.workout.exercises[0]!.sets.map((x) => [x.reps, x.weight, x.setType])).toEqual([
      [8, null, "working"],
      [10, null, "working"],
      [6, null, "failure"],
    ]);
    expect(t.notices).toEqual([{ code: "assist_weight_ignored", count: 1 }]);
  });
});

describe("19.1 Phase A — set drop counts (pure; the batch sum is the API's): every set received is kept, dropped or ignored", () => {
  it("over every-drop.json the counts add up, and each kind is present", () => {
    const f = fixture("every-drop");
    const t = created(translateHevyWorkout(f, ctx));
    const received = f.exercises.reduce((n, e) => n + e.sets.length, 0);
    const kept = t.workout.exercises.reduce((n, e) => n + e.sets.length, 0);
    const setDrops = ["exercise_skipped", "set_missing_measure", "set_forbidden_measure", "set_out_of_range"].reduce(
      (n, code) => n + count(t.drops, code),
      0,
    );
    expect(kept + setDrops + count(t.notices, "placeholder_sets_ignored")).toBe(received);
    expect(t.drops).toEqual([
      { code: "exercise_skipped", count: 3 },
      { code: "exercise_no_sets", count: 1 },
      { code: "set_missing_measure", count: 3 },
      { code: "set_forbidden_measure", count: 1 },
      { code: "set_out_of_range", count: 1 },
    ]);
    expect(t.notices).toEqual([
      { code: "custom_metric_ignored", count: 1 },
      { code: "assist_weight_ignored", count: 1 },
      { code: "placeholder_sets_ignored", count: 2 },
    ]);
    expect(kept).toBe(4);
  });
});

describe("stress — 100 exercises × 5 sets", () => {
  it("translates in under 50 ms", () => {
    const w = hworkout(
      Array.from({ length: 100 }, (_, i) =>
        hex(i % 2 ? "BENCH" : "SQUAT", Array.from({ length: 5 }, () => hset({ weightKg: 100, reps: 5 })), { supersetId: i % 10 }),
      ),
    );
    translateHevyWorkout(w, ctx);
    const t0 = performance.now();
    const t = created(translateHevyWorkout(w, ctx));
    expect(performance.now() - t0).toBeLessThan(50);
    expect(t.workout.exercises).toHaveLength(100);
  });
});
