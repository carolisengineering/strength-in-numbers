import { describe, expect, it } from "vitest";
import { HevyRoutinePageSchema, ROUTINES_PER_USER_MAX, translateHevyRoutine, type HevyFolder, type HevyPair, type HevyRoutine } from "@sin/core";

import { exerciseId } from "../../../test/catalogFixtures";
import { hevyFixtures } from "../../../test/hevyFixtures";
import { groupRoutines, pickAvailability, room, routineNameKey, tickAllInFolder, toggle, type PickContext, type PickState } from "./routinePicks";

const routine = (id: string, title: string, folder_id: number | null = null): HevyRoutine => ({ id, title, folder_id, exercises: [] });
const folder = (id: number, index: number, title = `Folder ${id}`): HevyFolder => ({ id, index, title });
const none: PickState = { picked: new Set() };

function ctxFor(routines: HevyRoutine[], over: Partial<PickContext> = {}): PickContext {
  return { picks: none, existingNames: new Set(), routineCount: 0, routinesById: new Map(routines.map((r) => [r.id, r])), ...over };
}

describe("20.1 AC7 — grouping", () => {
  it("orders folders by index, keeps Hevy's order inside, and puts No folder last", () => {
    const folders = [folder(10, 2), folder(11, 0), folder(12, 1)];
    const routines = [routine("a", "A", 10), routine("b", "B", null), routine("c", "C", 11), routine("d", "D", 99), routine("e", "E", 11), routine("f", "F", 12)];
    const groups = groupRoutines(folders, routines);
    expect(groups.map((g) => g.folderId)).toEqual([11, 12, 10, null]);
    expect(groups[0]!.routines.map((r) => r.id)).toEqual(["c", "e"]);
    expect(groups[3]).toMatchObject({ folderId: null, title: null });
    expect(groups[3]!.routines.map((r) => r.id)).toEqual(["b", "d"]);
  });

  it("leaves out empty folders and an empty No folder", () => {
    expect(groupRoutines([folder(1, 0), folder(2, 1)], [routine("a", "A", 2)]).map((g) => g.folderId)).toEqual([2]);
  });
});

describe("20.1 AC7 — availability and room", () => {
  const routines = [routine("r1", "Push A"), routine("r2", "Pull A"), routine("r3", "Legs"), routine("r4", "Legs"), routine("r5", "Arms")];

  it("room counts SIN's routines and the picks", () => {
    expect(room(48, none)).toBe(2);
    expect(room(48, { picked: new Set(["r1"]) })).toBe(1);
    expect(room(ROUTINES_PER_USER_MAX + 3, none)).toBe(0);
  });

  it("once the room is used, a further routine is no_room; a picked one stays ok", () => {
    const base = ctxFor(routines, { routineCount: 48 });
    let picks = toggle(none, "r1", base);
    picks = toggle(picks, "r2", { ...base, picks });
    expect([...picks.picked]).toEqual(["r1", "r2"]);
    expect(pickAvailability(routines[4]!, { ...base, picks })).toBe("no_room");
    expect(pickAvailability(routines[0]!, { ...base, picks })).toBe("ok");
    expect(toggle(picks, "r5", { ...base, picks })).toBe(picks);
  });

  it("a name already in SIN (trimmed, any case) is exists", () => {
    const ctx = ctxFor(routines, { existingNames: new Set([routineNameKey("  push a  ")]) });
    expect(pickAvailability(routines[0]!, ctx)).toBe("exists");
  });

  it("compares the first 80 code points", () => {
    const long = "B".repeat(90);
    const ctx = ctxFor([], { existingNames: new Set([routineNameKey("b".repeat(80))]) });
    expect(pickAvailability(routine("x", long), ctx)).toBe("exists");
  });

  it("cuts where cutCodePoints cuts: an emoji across the 80th unit is dropped whole", () => {
    expect(routineNameKey(`${"a".repeat(79)}💪 day`)).toBe("a".repeat(79));
    expect(routineNameKey("\u0007 Legs\u007f ")).toBe("legs");
    expect(routineNameKey("   ")).toBe("hevy routine");
  });

  it("matches translateHevyRoutine's name for every fixture routine", () => {
    const fixture = HevyRoutinePageSchema.parse(hevyFixtures.routinesPage()).routines;
    const items = fixture[0]!.exercises;
    const extra = [`${"a".repeat(79)}💪 day`, "  Mixed Case  ", "\t", "Upper\u0000Body"].map((title, i) => ({ ...routine(`e${i}`, title), exercises: items }));
    const pairs = new Map<string, HevyPair>(
      items.map((e) => [
        e.exercise_template_id,
        { hevyTemplateId: e.exercise_template_id, hevyTitle: e.title, hevyType: "weight_reps", role: "exercise", exerciseId: exerciseId(1), exerciseActive: true, measureRule: null, exportAs: false },
      ]),
    );
    const exercises = new Map([[exerciseId(1), { name: "Bench Press", modality: "weight_reps" as const, active: true, rootId: exerciseId(1) }]]);
    let checked = 0;
    for (const r of [...fixture, ...extra]) {
      const translated = translateHevyRoutine(r, { pairs, exercises, unit: "kg" });
      expect(translated.ok).toBe(true);
      if (!translated.ok) continue;
      expect(routineNameKey(r.title)).toBe(translated.input.name.toLowerCase());
      checked += 1;
    }
    expect(checked).toBe(fixture.length + extra.length);
  });

  it("a second Hevy routine with a picked routine's name is same_name_chosen", () => {
    const base = ctxFor(routines);
    const picks = toggle(none, "r3", base);
    expect(pickAvailability(routines[3]!, { ...base, picks })).toBe("same_name_chosen");
    expect(pickAvailability(routines[2]!, { ...base, picks })).toBe("ok");
  });

  it("tick all ticks the available routines up to the room, in group order", () => {
    const group = { folderId: 1, title: "F", routines: [routine("t1", "One"), routine("t2", "Two"), routine("t3", "Three"), routine("t4", "Four"), routine("t5", "Five")] };
    const ctx = ctxFor(group.routines, { routineCount: 48, existingNames: new Set([routineNameKey("One")]) });
    const picks = tickAllInFolder(none, group, ctx);
    expect([...picks.picked]).toEqual(["t2", "t3"]);
  });

  it("nothing is ticked initially", () => {
    expect(none.picked.size).toBe(0);
  });
});
