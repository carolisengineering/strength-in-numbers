import { describe, expect, it } from "vitest";
import { hevyFingerprintSource, type WorkoutDetail } from "../src/index.js";
import { detail, exercise, exerciseId, section, set } from "./fixtures/hevy/workout-detail.js";

// Built fresh on every call: a mutator must never reach the baseline.
const fin = () => section(0, "Finisher", { notes: "fast" });
const base = (): WorkoutDetail =>
  detail({
    title: "Push",
    notes: "n",
    routineName: "Upper",
    sections: [fin(), section(1, "Cooldown")],
    exercises: [
      exercise(0, { sectionId: fin().id, notes: "e", supersetGroup: 1, sets: [set({ rpe: 8, reps: 5 }), set({ setNumber: 2 })] }),
      exercise(1, { supersetGroup: 1 }),
    ],
  });

type Mutator = (d: WorkoutDetail) => void;
const ex0 = (d: WorkoutDetail) => d.exercises[0]!;
const set0 = (d: WorkoutDetail) => d.exercises[0]!.sets[0]!;

describe("19.0 AC13 — the fingerprint source", () => {
  it("starts with the version tag v1 and has no whitespace outside strings", () => {
    const source = hevyFingerprintSource(base());
    expect(source.startsWith("v1")).toBe(true);
    expect(hevyFingerprintSource(detail({ title: "A" }))).not.toMatch(/\s/);
  });

  const INCLUDED: [string, Mutator][] = [
    ["title", (d) => void (d.title = "Pull")],
    ["notes", (d) => void (d.notes = "other")],
    ["startedAt", (d) => void (d.startedAt = "2026-10-01T09:00:00.000-05:00")],
    ["endedAt", (d) => void (d.endedAt = "2026-10-01T12:00:00.000-05:00")],
    ["routineName", (d) => void (d.routineName = "Lower")],
    ["sections[0].name", (d) => void (d.sections[0]!.name = "Burnout")],
    ["sections[0].notes", (d) => void (d.sections[0]!.notes = "slow")],
    ["sections[0].position", (d) => void (d.sections[0]!.position = 5)],
    ["exercises[0].position", (d) => void (ex0(d).position = 9)],
    ["exercises[0].exerciseId", (d) => void (ex0(d).exerciseId = exerciseId(77) as never)],
    ["exercises[0].notes", (d) => void (ex0(d).notes = "x")],
    ["exercises[0].supersetGroup", (d) => void (ex0(d).supersetGroup = 2)],
    ["exercises[0].sectionId", (d) => void (ex0(d).sectionId = null)],
    ["sets[0].setType", (d) => void (set0(d).setType = "failure")],
    ["sets[0].reps", (d) => void (set0(d).reps = 6)],
    ["sets[0].weightKg", (d) => void (set0(d).weightKg = 61)],
    ["sets[0].distanceM", (d) => void (set0(d).distanceM = 10)],
    ["sets[0].durationS", (d) => void (set0(d).durationS = 10)],
    ["sets[0].calories", (d) => void (set0(d).calories = 10)],
    ["sets[0].rpe", (d) => void (set0(d).rpe = 9)],
  ];

  it.each(INCLUDED)("changes when %s changes", (_l, mutate) => {
    const changed = base();
    mutate(changed);
    expect(hevyFingerprintSource(changed)).not.toBe(hevyFingerprintSource(base()));
  });

  const EXCLUDED: [string, Mutator][] = [
    ["updatedAt", (d) => void (d.updatedAt = "2027-01-01T00:00:00.000Z")],
    ["createdAt", (d) => void (d.createdAt = "2027-01-01T00:00:00.000Z")],
    ["localDate", (d) => void (d.localDate = "2026-10-02")],
    ["tzOffsetMinutes", (d) => void (d.tzOffsetMinutes = 60)],
    ["a set id", (d) => void (set0(d).id = "00000000-0000-4000-8000-000000009999" as never)],
    ["an exercise id", (d) => void (ex0(d).id = "00000000-0000-4000-8000-000000009998" as never)],
    ["plannedSets", (d) => void (ex0(d).plannedSets = [{ setType: "working", reps: null, repsLow: 5, repsHigh: 8, weight: null, weightUnit: null, durationS: null, distance: null, distanceUnit: null, calories: null, rpe: null } as never])],
    ["isComplete", (d) => void (set0(d).isComplete = false)],
    ["completedAt", (d) => void (set0(d).completedAt = null)],
    ["routineIsOneOff", (d) => void (d.routineIsOneOff = true)],
    ["routineNotes", (d) => void (d.routineNotes = "from the routine")],
    ["addedInWorkout", (d) => void (d.sections[0]!.addedInWorkout = true)],
  ];

  it.each(EXCLUDED)("stays equal when %s changes", (_l, mutate) => {
    const changed = base();
    mutate(changed);
    expect(hevyFingerprintSource(changed)).toBe(hevyFingerprintSource(base()));
  });

  it("stays equal when the arrays are reordered without changing positions", () => {
    const shuffled = base();
    shuffled.exercises.reverse();
    shuffled.sections.reverse();
    shuffled.exercises.find((e) => e.position === 0)!.sets.reverse();
    expect(hevyFingerprintSource(shuffled)).toBe(hevyFingerprintSource(base()));
  });
});

describe("09.5 Phase A — an untimed workout's source is unchanged", () => {
  // Computed from the pre-change hevyFingerprintSource (main 53fc203), before WorkoutSection gained keys.
  const GOLDEN_BASE =
    'v1["Push","n","2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00","Upper",[["Finisher","fast",0],["Cooldown",null,1]],[[0,"00000000-0000-4000-8000-000000001000","e",1,0,[["working",5,60,null,null,null,8],["working",5,60,null,null,null,null]]],[1,"00000000-0000-4000-8000-000000001001",null,1,-1,[["working",5,60,null,null,null,null]]]]]';
  const GOLDEN_EMPTY = 'v1["A",null,"2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00",null,[],[]]';

  it("matches the pre-change goldens", () => {
    expect(hevyFingerprintSource(base())).toBe(GOLDEN_BASE);
    expect(hevyFingerprintSource(detail({ title: "A" }))).toBe(GOLDEN_EMPTY);
  });

  it("an untimed section's result and round times never reach the source", () => {
    const d = base();
    d.sections[0]!.roundTimes = [{ round: 1, seconds: 221 }];
    d.sections[0]!.result = { rounds: 4, reps: 7, finishSeconds: null, capped: true };
    expect(hevyFingerprintSource(d)).toBe(GOLDEN_BASE);
  });
});

// Spec 09.5 Phase C — timed sections in the fingerprint (§6.7, D18).
describe("09.5 AC29 — timed data in the fingerprint", () => {
  const noResult = { rounds: null, reps: null, finishSeconds: null, capped: false };
  const st = () =>
    section(0, "Main", {
      notes: "Rx",
      timer: { format: "set_timer", roundSeconds: 300, rounds: 5 },
      roundTimes: [221, 218, 210, 205, 208].map((seconds, i) => ({ round: i + 1, seconds })),
    });
  const tc = () =>
    section(1, "Finisher", { timer: { format: "time_cap", capSeconds: 900 }, result: { ...noResult, rounds: 4, reps: 7, capped: true } });
  const timedBase = (): WorkoutDetail =>
    detail({ sections: [st(), tc(), section(2, "Cooldown")], exercises: [exercise(0, { sectionId: st().id }), exercise(1, { sectionId: tc().id })] });
  const src = (d: WorkoutDetail) => hevyFingerprintSource(d);
  const withSection = (i: number, f: (s: WorkoutDetail["sections"][number]) => WorkoutDetail["sections"][number]) => {
    const d = timedBase();
    return { ...d, sections: d.sections.map((s, j) => (j === i ? f(s) : s)) };
  };

  it("(b) the version tag stays v1", () => {
    expect(src(timedBase()).startsWith("v1")).toBe(true);
  });

  it.each<[string, () => WorkoutDetail]>([
    ["roundSeconds", () => withSection(0, (s) => ({ ...s, timer: { format: "set_timer", roundSeconds: 301, rounds: 5 } }))],
    ["rounds", () => withSection(0, (s) => ({ ...s, timer: { format: "set_timer", roundSeconds: 300, rounds: 6 } }))],
    ["the time cap's capSeconds", () => withSection(1, (s) => ({ ...s, timer: { format: "time_cap", capSeconds: 960 } }))],
    ["one round's seconds", () => withSection(0, (s) => ({ ...s, roundTimes: s.roundTimes.map((r) => (r.round === 3 ? { ...r, seconds: 211 } : r)) }))],
    ["adding a round", () => withSection(0, (s) => ({ ...s, timer: { format: "set_timer", roundSeconds: 300, rounds: 6 }, roundTimes: [...s.roundTimes, { round: 6, seconds: 200 }] }))],
    ["removing a round", () => withSection(0, (s) => ({ ...s, roundTimes: s.roundTimes.slice(0, 4) }))],
    ["the result's rounds", () => withSection(1, (s) => ({ ...s, result: { ...s.result!, rounds: 5 } }))],
    ["the result's reps", () => withSection(1, (s) => ({ ...s, result: { ...s.result!, reps: 8 } }))],
    ["the result's finishSeconds", () => withSection(1, (s) => ({ ...s, result: { ...noResult, finishSeconds: 860 } }))],
    ["the capped flag", () => withSection(1, (s) => ({ ...s, result: { ...s.result!, capped: false } }))],
    ["setting a timer on an untimed section", () => withSection(2, (s) => ({ ...s, timer: { format: "amrap", capSeconds: 600 } }))],
  ])("(c) a change to %s changes the source", (_label, mutate) => {
    expect(src(mutate())).not.toBe(src(timedBase()));
  });

  it("round times hash in round order, whatever order they are given in", () => {
    const at = (order: number[]) =>
      src(withSection(0, (s) => ({ ...s, roundTimes: order.map((round) => ({ round, seconds: 200 + round })) })));
    expect(at([3, 1])).toBe(at([1, 3]));
  });

  it("the timed entry's exact shape (§6.7): absent plan numbers are null, round times sorted", () => {
    const s = section(0, "Main", {
      notes: "Rx",
      timer: { format: "amrap", capSeconds: 720 },
      result: { ...noResult, rounds: 5, reps: 7 },
      roundTimes: [{ round: 2, seconds: 515 }, { round: 1, seconds: 250 }],
    });
    const out = src(detail({ title: null, notes: null, routineName: null, sections: [s], exercises: [] }));
    expect(out).toBe(
      'v1[null,null,"2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00",null,' +
        '[["Main","Rx",0,["amrap",null,null,720],[5,7,null,false],[[1,250],[2,515]]]],[]]',
    );
    const untimedResult = src(detail({ title: null, notes: null, routineName: null, sections: [section(0, "Main", { notes: "Rx" })], exercises: [] }));
    expect(untimedResult).toBe('v1[null,null,"2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00",null,[["Main","Rx",0]],[]]');
  });

  it("a timed section with no result has null in the result slot", () => {
    const s = section(0, "Main", { timer: { format: "set_timer", roundSeconds: 300, rounds: 5 } });
    expect(src(detail({ sections: [s] }))).toContain('[["Main",null,0,["set_timer",300,5,null],null,[]]]');
  });

  it("an empty timed section (no exercises) still changes the source", () => {
    const empty = () => section(0, "Finisher", { timer: null });
    const untimed = detail({ sections: [empty()], exercises: [exercise(0)] });
    const timedEmpty = detail({ sections: [{ ...empty(), timer: { format: "time_cap", capSeconds: 900 }, result: { ...noResult, finishSeconds: 860 } }], exercises: [exercise(0)] });
    expect(src(timedEmpty)).not.toBe(src(untimed));
  });
});

describe("09.5 AC29 — a timed workout's source is unchanged by the #238 / #241 refactor", () => {
  // Computed from hevyFingerprintSource on main 1983850, before the shared helpers.
  const GOLDEN_TIMED =
    'v1["Timed",null,"2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00",null,[["Main",null,0,["set_timer",300,5,null],null,[[1,221],[2,218],[3,210]]],["Finisher","go",1,["amrap",null,null,720],[5,7,null,false],[]],["Cooldown",null,2]],[[0,"00000000-0000-4000-8000-000000001000",null,null,0,[["working",5,60,null,null,null,null]]],[1,"00000000-0000-4000-8000-000000001001",null,null,1,[["working",5,60,null,null,null,null]]]]]';
  const main = () =>
    section(0, "Main", {
      timer: { format: "set_timer", roundSeconds: 300, rounds: 5 },
      roundTimes: [
        { round: 3, seconds: 210 },
        { round: 1, seconds: 221 },
        { round: 2, seconds: 218 },
      ],
    });
  const amrap = () =>
    section(1, "Finisher", { notes: "go", timer: { format: "amrap", capSeconds: 720 }, result: { rounds: 5, reps: 7, finishSeconds: null, capped: false } });
  const timed = (): WorkoutDetail =>
    detail({ title: "Timed", sections: [main(), amrap(), section(2, "Cooldown")], exercises: [exercise(0, { sectionId: main().id }), exercise(1, { sectionId: amrap().id })] });

  it("matches the pre-change golden", () => {
    expect(hevyFingerprintSource(timed())).toBe(GOLDEN_TIMED);
  });

  it("a section with no timer key reads as untimed and does not throw (#238)", () => {
    const d = timed();
    const keyless = { ...d, sections: d.sections.map((s, i) => (i === 2 ? (({ timer: _t, ...rest }) => rest)(s) : s)) } as unknown as WorkoutDetail;
    expect(hevyFingerprintSource(keyless)).toBe(GOLDEN_TIMED);
  });
});
