import { describe, expect, it } from "vitest";
import { assignSupersets, translateHevyWorkout, type HevyWorkoutTranslation } from "../src/index.js";
import { fixture, hex, hset, hworkout, importContext } from "./fixtures/hevy/import/context.js";

const ctx = importContext();
const lift = (id = "BENCH", o: Parameters<typeof hex>[2] = {}) => hex(id, [hset({ weightKg: 60, reps: 5 })], o);
const marker = (notes: string | null, id = "WORKOUT", o: Parameters<typeof hex>[2] = {}) => hex(id, [hset({ reps: 1 })], { notes, ...o });

function created(t: HevyWorkoutTranslation) {
  if (t.outcome !== "create") throw new Error(`expected create, got ${t.outcome}`);
  return t;
}
const count = (list: { code: string; count: number }[], code: string) => list.find((c) => c.code === code)?.count ?? 0;

describe("19.1 AC3 — sections from placeholders", () => {
  const t = created(translateHevyWorkout(fixture("sections"), ctx));

  it("exercises before the first placeholder are loose; each later one belongs to the section above it", () => {
    expect(t.workout.exercises.map((e) => e.sectionIndex)).toEqual([null, 0, 1, 1, 2]);
  });

  it("a warm-up placeholder starts Warm-up with its notes as the note", () => {
    expect(t.workout.sections[0]).toEqual({ name: "Warm-up", notes: "Bike 5 min" });
  });

  it("a workout placeholder is named by its first line, the rest being the note", () => {
    expect(t.workout.sections[1]).toEqual({ name: "Hiraya", notes: "Rx: as written" });
  });

  it("a workout placeholder with empty notes is Workout", () => {
    expect(t.workout.sections[2]).toEqual({ name: "Workout", notes: null });
  });

  it("a placeholder's own sets are ignored, counted", () => {
    expect(count(t.notices, "placeholder_sets_ignored")).toBe(2);
  });

  it("two placeholders in a row: one section_empty, no empty section, dense indexes after", () => {
    const r = created(translateHevyWorkout(hworkout([marker("A"), marker("B"), lift(), marker("C"), lift()]), ctx));
    expect(r.workout.sections.map((s) => s.name)).toEqual(["B", "C"]);
    expect(r.workout.exercises.map((e) => e.sectionIndex)).toEqual([0, 1]);
    expect(count(r.notices, "section_empty")).toBe(1);
  });

  it("a placeholder whose exercises were all skipped or emptied is section_empty", () => {
    const r = created(translateHevyWorkout(hworkout([lift(), marker("A"), hex("SKIP", [hset()]), hex("SQUAT", []), marker("B"), lift()]), ctx));
    expect(r.workout.sections.map((s) => s.name)).toEqual(["B"]);
    expect(count(r.notices, "section_empty")).toBe(1);
  });

  it("a trailing placeholder is section_empty", () => {
    const r = created(translateHevyWorkout(hworkout([lift(), marker("A")]), ctx));
    expect([r.workout.sections, count(r.notices, "section_empty")]).toEqual([[], 1]);
  });

  it("an exercise titled Accessory never creates a section", () => {
    const c = importContext();
    const pairs = new Map(c.pairs);
    pairs.set("BENCH", { ...pairs.get("BENCH")!, hevyTitle: "Accessory" });
    const r = created(translateHevyWorkout(hworkout([marker("A"), lift(), lift()]), { ...c, pairs }));
    expect(r.workout.sections.map((s) => s.name)).toEqual(["A"]);
    expect(r.workout.exercises.map((e) => e.sectionIndex)).toEqual([0, 0]);
  });

  it("nine placeholders: 8 sections, sections_over_limit 1, the ninth's exercises stay in the eighth", () => {
    const nine = Array.from({ length: 9 }, (_, i) => [marker(`S${i + 1}`), lift()]).flat();
    const r = created(translateHevyWorkout(hworkout(nine), ctx));
    expect(r.workout.sections.map((s) => s.name)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]);
    expect(r.workout.exercises.map((e) => e.sectionIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 7]);
    expect(count(r.notices, "sections_over_limit")).toBe(1);
  });

  it("a section name over 40 and a note over 2000 are cut with their notices", () => {
    const r = created(translateHevyWorkout(hworkout([marker(`${"n".repeat(41)}\n${"x".repeat(2001)}`), lift()]), ctx));
    expect([r.workout.sections[0]!.name.length, r.workout.sections[0]!.notes!.length]).toEqual([40, 2000]);
    expect([count(r.notices, "section_name_trimmed"), count(r.notices, "section_notes_trimmed")]).toEqual([1, 1]);
  });

  it("control characters never reach a section name or note", () => {
    const r = created(translateHevyWorkout(hworkout([marker("Hi\traya\u0007\nRx\u0000 line\ttwo"), lift()]), ctx));
    expect(r.workout.sections[0]).toEqual({ name: "Hiraya", notes: "Rx line\ttwo" });
  });
});

describe("19.1 AC7 — supersets", () => {
  const groupsOf = (ids: (number | null)[]) =>
    created(translateHevyWorkout(hworkout(ids.map((supersetId) => lift("BENCH", { supersetId }))), ctx)).workout.exercises.map(
      (e) => e.supersetGroup,
    );

  it("distinct Hevy ids become 1, 2, 3 in order of first appearance", () => {
    expect(groupsOf([5, 5, 2, null, 2])).toEqual([1, 1, 2, null, 2]);
  });

  it("a group of one becomes null and the others stay dense", () => {
    expect(groupsOf([5, 3, 3])).toEqual([null, 1, 1]);
  });

  it("a group whose other member was skipped or emptied becomes null", () => {
    const w = hworkout([lift("BENCH", { supersetId: 5 }), hex("SKIP", [hset()], { supersetId: 5 }), hex("SQUAT", [], { supersetId: 5 })]);
    expect(created(translateHevyWorkout(w, ctx)).workout.exercises.map((e) => e.supersetGroup)).toEqual([null]);
  });

  it("a placeholder carrying a superset id is not a member", () => {
    const w = hworkout([lift("BENCH", { supersetId: 5 }), marker("A", "WORKOUT", { supersetId: 5 }), lift("SQUAT", { supersetId: 5 })]);
    const r = created(translateHevyWorkout(w, ctx));
    expect(r.workout.exercises.map((e) => e.supersetGroup)).toEqual([1, 1]);
  });

  it("100 distinct pairs: groups 1–99, the 100th null, superset_over_limit 1", () => {
    const ids = Array.from({ length: 100 }, (_, i) => [i, i]).flat();
    const w = hworkout(ids.map((supersetId) => lift("BENCH", { supersetId })));
    const r = created(translateHevyWorkout(w, ctx));
    const groups = r.workout.exercises.map((e) => e.supersetGroup);
    expect(groups.slice(0, 198)).toEqual(Array.from({ length: 99 }, (_, i) => [i + 1, i + 1]).flat());
    expect(groups.slice(198)).toEqual([null, null]);
    expect(count(r.notices, "superset_over_limit")).toBe(1);
  });

  it("assignSupersets keeps at most maxMembers of a group and counts the cut group", () => {
    expect(assignSupersets([7, 7, 7, null], { maxMembers: 2 })).toEqual({ groups: [1, 1, null, null], overLimit: 0, cut: 1 });
    expect(assignSupersets([])).toEqual({ groups: [], overLimit: 0, cut: 0 });
  });

  it("assignSupersets takes any key type", () => {
    expect(assignSupersets(["a:1", "b:1", "a:1", "b:1"]).groups).toEqual([1, 2, 1, 2]);
  });
});
