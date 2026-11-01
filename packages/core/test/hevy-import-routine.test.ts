import { describe, expect, it } from "vitest";
import {
  HevyRoutineSchema,
  QUICK_LINE_KEYS,
  RoutineWriteSchema,
  hevyRoutineName,
  plannedSetViolations,
  ROUTINE_NAME_MAX,
  translateHevyRoutine,
  type HevyRoutine,
  type HevyRoutineExercise,
  type HevyRoutineTranslation,
  type RoutineWrite,
} from "../src/index.js";
import { importContext, jsonFixture, sinId } from "./fixtures/hevy/import/context.js";

const routineContext = (unit: "kg" | "lb") => {
  const { pairs, exercises } = importContext(unit);
  return { pairs, exercises, unit };
};
const ctx = routineContext("kg");
const lbCtx = routineContext("lb");
const routine = (name: string): HevyRoutine => HevyRoutineSchema.parse(jsonFixture(name));
const FIXTURES = ["routine-basic", "routine-sections", "routine-modalities"] as const;

let index = 0;
const item = (exercise_template_id: string, o: Partial<HevyRoutineExercise> = {}): HevyRoutineExercise => ({
  index: index++,
  title: exercise_template_id,
  exercise_template_id,
  notes: null,
  superset_id: null,
  rest_seconds: null,
  sets: [{ type: "normal", weight_kg: 60, reps: 5 }],
  ...o,
});
const hevyRoutine = (exercises: HevyRoutineExercise[], title = "Plan"): HevyRoutine => ({ id: "r", title, folder_id: null, exercises });

function ok(t: HevyRoutineTranslation) {
  if (!t.ok) throw new Error(`expected ok, got ${t.reason}`);
  return t;
}
const count = (list: { code: string; count: number }[], code: string) => list.find((c) => c.code === code)?.count ?? 0;
const MODALITY_OF = new Map([...ctx.exercises].map(([id, info]) => [id, info.modality]));

function expectWritable(input: RoutineWrite) {
  const parsed = RoutineWriteSchema.safeParse(input);
  expect(parsed.error?.issues ?? []).toEqual([]);
  for (const it of input.items) {
    expect(plannedSetViolations(MODALITY_OF.get(it.exerciseId)!, it.sets ?? [])).toEqual([]);
    for (const key of QUICK_LINE_KEYS) expect(Object.hasOwn(it, key)).toBe(false);
    expect(Array.isArray(it.sets)).toBe(true);
  }
}

describe("19.1 AC11 — translateHevyRoutine: name", () => {
  it("the title is trimmed", () => {
    expect(ok(translateHevyRoutine(routine("routine-basic"), ctx)).input.name).toBe("Upper A");
  });

  it("a 90-character title is cut to 80 with name_trimmed", () => {
    const t = ok(translateHevyRoutine(hevyRoutine([item("BENCH")], "r".repeat(90)), ctx));
    expect([t.input.name.length, count(t.notices, "name_trimmed")]).toEqual([80, 1]);
  });

  it("minor 276: a title the cut keeps nothing of is 'Hevy routine', with no name_trimmed", () => {
    const t = ok(translateHevyRoutine(hevyRoutine([item("BENCH")], `H${"\u0301".repeat(90)}`), ctx));
    expect([t.input.name, count(t.notices, "name_trimmed")]).toEqual(["Hevy routine", 0]);
  });

  it("no routine-level notes are written", () => {
    expect(Object.hasOwn(ok(translateHevyRoutine(routine("routine-basic"), ctx)).input, "notes")).toBe(false);
  });
});

describe("19.1 AC11 — sections", () => {
  const t = ok(translateHevyRoutine(routine("routine-sections"), ctx));

  it("placeholders become sections keyed s1, s2… named as in AC3", () => {
    expect(t.input.sections).toEqual([
      { key: "s1", name: "Warm-up", notes: "Bike" },
      { key: "s2", name: "Hiraya", notes: "Rx" },
      { key: "s3", name: "Finisher" },
    ]);
  });

  it("loose items come first, then each section's items", () => {
    expect(t.input.items.map((i) => i.sectionKey ?? null)).toEqual([null, "s1", "s2", "s2", "s3"]);
  });

  it("an empty section is section_empty", () => {
    expect(count(t.notices, "section_empty")).toBe(1);
  });

  it("a superset never spans sections: the same Hevy id in a later section is its own group", () => {
    expect(t.input.items.map((i) => i.supersetGroup ?? null)).toEqual([null, null, 1, 1, null]);
  });

  it("nine placeholders give 8 sections and sections_over_limit", () => {
    const nine = Array.from({ length: 9 }, (_, i) => [item("WORKOUT", { notes: `S${i + 1}` }), item("BENCH")]).flat();
    const r = ok(translateHevyRoutine(hevyRoutine(nine), ctx));
    expect(r.input.sections).toHaveLength(8);
    expect(r.input.items.map((i) => i.sectionKey)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s8"]);
    expect(count(r.notices, "sections_over_limit")).toBe(1);
    expectWritable(r.input);
  });

  it("a section left empty by the item cap is removed", () => {
    const items = [...Array.from({ length: 30 }, () => item("BENCH")), item("WORKOUT", { notes: "Late" }), item("SQUAT")];
    const r = ok(translateHevyRoutine(hevyRoutine(items), ctx));
    expect([r.input.items.length, r.input.sections]).toEqual([30, undefined]);
    expectWritable(r.input);
  });
});

describe("19.1 AC11 — items", () => {
  it("skip pairs are omitted; items keep their order and SIN ids", () => {
    const t = ok(translateHevyRoutine(routine("routine-basic"), ctx));
    expect(t.input.items.map((i) => i.exerciseId)).toEqual([sinId(1), sinId(4)]);
  });

  it("31 kept items give 30 and items_cut", () => {
    const t = ok(translateHevyRoutine(hevyRoutine(Array.from({ length: 31 }, () => item("BENCH"))), ctx));
    expect([t.input.items.length, count(t.notices, "items_cut")]).toEqual([30, 1]);
  });

  it("rest is kept, clamped to 0–900 with rest_clamped", () => {
    const t = ok(
      translateHevyRoutine(
        hevyRoutine([item("BENCH", { rest_seconds: 1200 }), item("SQUAT", { rest_seconds: -5 }), item("ROW", { rest_seconds: 90 }), item("PULLUP")]),
        ctx,
      ),
    );
    expect(t.input.items.map((i) => i.restSeconds ?? null)).toEqual([900, 0, 90, null]);
    expect(count(t.notices, "rest_clamped")).toBe(2);
  });

  it("item notes are kept, cut to 500 with notes_trimmed", () => {
    const t = ok(translateHevyRoutine(hevyRoutine([item("BENCH", { notes: "n".repeat(501) }), item("SQUAT", { notes: " pause " })]), ctx));
    expect(t.input.items.map((i) => i.notes?.length ?? null)).toEqual([500, 5]);
    expect(count(t.notices, "notes_trimmed")).toBe(1);
  });
});

describe("19.1 AC11 — supersets", () => {
  it("a 9-member group keeps the first 8 and superset_cut", () => {
    const t = ok(translateHevyRoutine(hevyRoutine(Array.from({ length: 9 }, () => item("BENCH", { superset_id: 4 }))), ctx));
    expect(t.input.items.map((i) => i.supersetGroup ?? null)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, null]);
    expect(count(t.notices, "superset_cut")).toBe(1);
    expectWritable(t.input);
  });

  it("a single member gets no group", () => {
    const t = ok(translateHevyRoutine(hevyRoutine([item("BENCH", { superset_id: 4 }), item("SQUAT", { superset_id: 2 }), item("ROW", { superset_id: 2 })]), ctx));
    expect(t.input.items.map((i) => i.supersetGroup ?? null)).toEqual([null, 1, 1]);
  });
});

describe("19.1 AC11 — planned rows", () => {
  const rowsOf = (sets: HevyRoutineExercise["sets"], id = "BENCH", c = ctx) => ok(translateHevyRoutine(hevyRoutine([item(id, { sets })]), c)).input.items[0]!.sets;

  it("types are mapped; a rep range is ordered; a single reps value fills both", () => {
    expect(ok(translateHevyRoutine(routine("routine-basic"), ctx)).input.items[0]!.sets).toEqual([
      { setType: "warmup", repsLow: 10, repsHigh: 10, weight: 40, weightUnit: "kg" },
      { setType: "working", repsLow: 8, repsHigh: 12, weight: 60, weightUnit: "kg" },
      { setType: "failure", repsLow: 5, repsHigh: 5, weight: 61.2, weightUnit: "kg" },
    ]);
  });

  it("rep_range {12, 8} gives 8–12; {0, 150} gives 1–100", () => {
    expect(rowsOf([{ type: "normal", rep_range: { start: 12, end: 8 } }, { type: "normal", rep_range: { start: 0, end: 150 } }])).toEqual([
      { setType: "working", repsLow: 8, repsHigh: 12 },
      { setType: "working", repsLow: 1, repsHigh: 100 },
    ]);
  });

  it("reps 0 or null leave the row without reps", () => {
    expect(rowsOf([{ type: "normal", reps: 0 }, { type: "dropset" }], "PULLUP")).toEqual([{ setType: "working" }, { setType: "drop" }]);
  });

  it("21 rows give 20 and sets_cut", () => {
    const t = ok(translateHevyRoutine(hevyRoutine([item("BENCH", { sets: Array.from({ length: 21 }, () => ({ type: "normal", reps: 5 })) })]), ctx));
    expect([t.input.items[0]!.sets!.length, count(t.notices, "sets_cut")]).toEqual([20, 1]);
  });

  it("weight converts to the lb user's unit to 0.1", () => {
    expect(rowsOf([{ type: "normal", weight_kg: 61.235, reps: 5 }], "BENCH", lbCtx)).toEqual([
      { setType: "working", repsLow: 5, repsHigh: 5, weight: 135, weightUnit: "lb" },
    ]);
  });

  it("a zero weight is no weight", () => {
    expect(rowsOf([{ type: "normal", weight_kg: 0, reps: 5 }])).toEqual([{ setType: "working", repsLow: 5, repsHigh: 5 }]);
  });

  it("an unknown Hevy set type is a working row", () => {
    expect(rowsOf([{ type: "superset_special", reps: 5, weight_kg: 50 }])).toEqual([
      { setType: "working", repsLow: 5, repsHigh: 5, weight: 50, weightUnit: "kg" },
    ]);
  });
});

describe("19.1 AC11 — measures each modality can plan", () => {
  const t = ok(translateHevyRoutine(routine("routine-modalities"), ctx));
  const byId = new Map<string, RoutineWrite["items"][number]["sets"]>(t.input.items.map((i) => [i.exerciseId, i.sets]));

  it.each([
    ["weight_reps", 1, [{ setType: "working", repsLow: 5, repsHigh: 5, weight: 60, weightUnit: "kg" }]],
    ["bodyweight_reps", 4, [{ setType: "working", repsLow: 8, repsHigh: 8 }]],
    ["weighted_bodyweight", 11, [{ setType: "working", repsLow: 8, repsHigh: 8, weight: 10, weightUnit: "kg" }]],
    ["duration", 9, [{ setType: "working" }]],
    ["distance_duration", 8, [{ setType: "working" }]],
    ["weight_duration", 10, [{ setType: "working", weight: 40, weightUnit: "kg" }]],
    ["weight_distance", 6, [{ setType: "working", weight: 24, weightUnit: "kg" }]],
    ["calories", 5, [{ setType: "working" }]],
    ["bodyweight_reps (assisted)", 7, [{ setType: "working", repsLow: 8, repsHigh: 8 }]],
  ] as const)("%s", (_label, n, rows) => {
    expect(byId.get(sinId(n))).toEqual(rows);
  });

  it("duration and distance targets are not kept, counted per row", () => {
    expect([count(t.notices, "time_targets_not_kept"), count(t.notices, "distance_targets_not_kept")]).toEqual([3, 2]);
  });
});

describe("19.1 AC11 — not translated", () => {
  it("an unpaired template gives unpaired with each id once", () => {
    const r = translateHevyRoutine(hevyRoutine([item("UNKNOWN"), item("BENCH"), item("RETIRED"), item("UNKNOWN")]), ctx);
    expect(r).toEqual({ ok: false, reason: "unpaired", unpaired: ["UNKNOWN", "RETIRED"] });
  });

  it("only placeholders and skips give no_items", () => {
    expect(translateHevyRoutine(routine("routine-only-placeholders"), ctx)).toEqual({ ok: false, reason: "no_items", unpaired: [] });
  });

  it("an empty routine gives no_items", () => {
    expect(translateHevyRoutine(hevyRoutine([]), ctx)).toEqual({ ok: false, reason: "no_items", unpaired: [] });
  });

  it("a blank title still gives a writable name", () => {
    const t = ok(translateHevyRoutine(hevyRoutine([item("BENCH")], " \u0001 "), ctx));
    expect(t.input.name).toBe("Hevy routine");
  });
});

describe("19.1 AC11 — every output is writable", () => {
  it.each(FIXTURES)("%s parses with RoutineWriteSchema and passes plannedSetViolations", (name) => {
    expectWritable(ok(translateHevyRoutine(routine(name), ctx)).input);
    expectWritable(ok(translateHevyRoutine(routine(name), lbCtx)).input);
  });

  it("a capped routine (31 items, 21 rows, a 9-member superset, rest 1200, a 90-character title) is writable", () => {
    const items = [
      ...Array.from({ length: 9 }, () => item("BENCH", { superset_id: 1, rest_seconds: 1200 })),
      item("SQUAT", { sets: Array.from({ length: 21 }, () => ({ type: "normal", reps: 5, weight_kg: 100 })) }),
      ...Array.from({ length: 21 }, () => item("ROW")),
    ];
    const t = ok(translateHevyRoutine(hevyRoutine(items, "c".repeat(90)), ctx));
    expect(t.notices.map((n) => n.code)).toEqual(["name_trimmed", "items_cut", "rest_clamped", "superset_cut", "sets_cut"]);
    expectWritable(t.input);
  });
});

describe("Minor 147 — a prototype-named set type falls back to working", () => {
  it.each(["toString", "__proto__", "constructor"])("type %j is a working row and the body is writable", (type) => {
    const t = ok(translateHevyRoutine(hevyRoutine([item("BENCH", { sets: [{ type, reps: 5 }] })]), ctx));
    expect(t.input.items[0]!.sets).toEqual([{ setType: "working", repsLow: 5, repsHigh: 5 }]);
    expectWritable(t.input);
  });
});

describe("Minor 146 — a one-cluster section note longer than the limit", () => {
  it("leaves the section with no notes, and the body stays writable", () => {
    const t = ok(translateHevyRoutine(hevyRoutine([item("WORKOUT", { notes: `Block\nH${"́".repeat(2100)}` }), item("SQUAT")]), ctx));
    expect(t.input.sections).toEqual([{ key: "s1", name: "Block" }]);
    expectWritable(t.input);
  });
});

describe("Minor 148 — trimmed notices count kept sections only", () => {
  const longNotes = `${"N".repeat(50)}\n${"z".repeat(2100)}`;

  it("a section the item cap removes adds no trimmed notice", () => {
    const items = [...Array.from({ length: 30 }, () => item("BENCH")), item("WORKOUT", { notes: longNotes }), item("SQUAT")];
    const t = ok(translateHevyRoutine(hevyRoutine(items), ctx));
    expect(t.input.sections).toBeUndefined();
    expect([count(t.notices, "section_name_trimmed"), count(t.notices, "section_notes_trimmed")]).toEqual([0, 0]);
  });

  it("the same section, kept, adds both", () => {
    const t = ok(translateHevyRoutine(hevyRoutine([item("WORKOUT", { notes: longNotes }), item("SQUAT")]), ctx));
    expect(t.input.sections).toHaveLength(1);
    expect([count(t.notices, "section_name_trimmed"), count(t.notices, "section_notes_trimmed")]).toEqual([1, 1]);
  });
});

describe("Minor 243 — hevyRoutineName", () => {
  it("removes control characters and trims", () => {
    expect(hevyRoutineName("  Push\u0007 Day ")).toBe("Push Day");
  });

  it("an empty, control-only or missing title is Hevy routine", () => {
    expect(hevyRoutineName("")).toBe("Hevy routine");
    expect(hevyRoutineName("\u0001")).toBe("Hevy routine");
    expect(hevyRoutineName(null)).toBe("Hevy routine");
  });

  it("is cut to the routine name limit (UTF-16 length, as the schema counts) without splitting a pair", () => {
    const cut = hevyRoutineName("😀".repeat(200));
    expect(cut).toHaveLength(ROUTINE_NAME_MAX);
    expect(cut).toBe("😀".repeat(ROUTINE_NAME_MAX / 2));
  });

  it("is the name translateHevyRoutine gives the routine", () => {
    for (const title of ["Upper A", "  Lower\u0002 B ", "", "r".repeat(90)]) {
      expect(ok(translateHevyRoutine(hevyRoutine([item("BENCH")], title), ctx)).input.name).toBe(hevyRoutineName(title));
    }
  });
});
