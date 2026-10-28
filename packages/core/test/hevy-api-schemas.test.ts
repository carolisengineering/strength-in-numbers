import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
  HevyCreateTemplateBodySchema,
  HevyCreateTemplateReplySchema,
  HevyCreateWorkoutReplySchema,
  HevyFolderPageSchema,
  HevyPostWorkoutSchema,
  HevyRoutinePageSchema,
  HevyRoutineSchema,
  HevySetSchema,
  HevyTemplatePageSchema,
  HevyTemplateSchema,
  HevyUpdateWorkoutReplySchema,
  HevyUserInfoSchema,
  HevyWorkoutCountSchema,
  HevyWorkoutPageSchema,
  HevyWorkoutSchema,
  readHevyType,
} from "../src/index.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/hevy/${name}`, import.meta.url), "utf8")) as unknown;

type Path = readonly (string | number)[];
const clone = <T>(v: T): T => structuredClone(v);
function at(obj: unknown, path: Path): Record<string | number, unknown> {
  let cur = obj as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) cur = cur[key] as Record<string | number, unknown>;
  return cur;
}
const without = (obj: unknown, path: Path) => {
  const copy = clone(obj);
  delete at(copy, path)[path[path.length - 1]!];
  return copy;
};
const withValue = (obj: unknown, path: Path, value: unknown) => {
  const copy = clone(obj);
  at(copy, path)[path[path.length - 1]!] = value;
  return copy;
};

interface Case {
  name: string;
  schema: ZodType;
  file: string;
  required: Path[];
  optional: Path[];
  extraKeyAt: Path;
}

const SET = ["sets", 0] as const;
const workoutRequired = (p: Path): Path[] => [
  [...p, "id"],
  [...p, "title"],
  [...p, "start_time"],
  [...p, "end_time"],
  [...p, "exercises"],
  [...p, "exercises", 0, "index"],
  [...p, "exercises", 0, "title"],
  [...p, "exercises", 0, "exercise_template_id"],
  [...p, "exercises", 0, "sets"],
  [...p, "exercises", 0, ...SET, "type"],
];
const workoutOptional = (p: Path): Path[] => [
  [...p, "description"],
  [...p, "updated_at"],
  [...p, "exercises", 0, "notes"],
  [...p, "exercises", 0, "superset_id"],
  [...p, "exercises", 0, ...SET, "index"],
  [...p, "exercises", 0, ...SET, "weight_kg"],
  [...p, "exercises", 0, ...SET, "reps"],
  [...p, "exercises", 0, ...SET, "distance_meters"],
  [...p, "exercises", 0, ...SET, "duration_seconds"],
  [...p, "exercises", 0, ...SET, "custom_metric"],
  [...p, "exercises", 0, ...SET, "rpe"],
];
const routineRequired = (p: Path): Path[] => [
  [...p, "id"],
  [...p, "title"],
  [...p, "exercises"],
  [...p, "exercises", 0, "index"],
  [...p, "exercises", 0, "title"],
  [...p, "exercises", 0, "exercise_template_id"],
  [...p, "exercises", 0, "sets"],
];
const routineOptional = (p: Path): Path[] => [
  [...p, "exercises", 0, "notes"],
  [...p, "exercises", 0, "superset_id"],
];
const templateRequired = (p: Path): Path[] => [[...p, "id"], [...p, "title"], [...p, "type"], [...p, "is_custom"]];
const templateOptional = (p: Path): Path[] => [
  [...p, "primary_muscle_group"],
  [...p, "secondary_muscle_groups"],
  [...p, "equipment"],
];

const CASES: Case[] = [
  { name: "user info", schema: HevyUserInfoSchema, file: "user-info.json", required: [["data"], ["data", "id"], ["data", "is_pro"]], optional: [["data", "username"], ["data", "name"], ["data", "url"]], extraKeyAt: ["data"] },
  { name: "template", schema: HevyTemplateSchema, file: "template.json", required: templateRequired([]), optional: templateOptional([]), extraKeyAt: [] },
  {
    name: "templates page",
    schema: HevyTemplatePageSchema,
    file: "templates-page.json",
    required: [["page"], ["page_count"], ["exercise_templates"], ...templateRequired(["exercise_templates", 0])],
    optional: templateOptional(["exercise_templates", 0]),
    extraKeyAt: [],
  },
  { name: "workout", schema: HevyWorkoutSchema, file: "workout.json", required: workoutRequired([]), optional: workoutOptional([]), extraKeyAt: [] },
  {
    name: "workouts page",
    schema: HevyWorkoutPageSchema,
    file: "workouts-page.json",
    required: [["page"], ["page_count"], ["workouts"], ...workoutRequired(["workouts", 0])],
    optional: workoutOptional(["workouts", 0]),
    extraKeyAt: ["workouts", 0, "exercises", 0],
  },
  { name: "routine", schema: HevyRoutineSchema, file: "routine.json", required: routineRequired([]), optional: routineOptional([]), extraKeyAt: [] },
  {
    name: "routines page",
    schema: HevyRoutinePageSchema,
    file: "routines-page.json",
    required: [["page"], ["page_count"], ["routines"], ...routineRequired(["routines", 0])],
    optional: routineOptional(["routines", 0]),
    extraKeyAt: ["routines", 0],
  },
  {
    name: "folders page",
    schema: HevyFolderPageSchema,
    file: "folders-page.json",
    required: [["page"], ["page_count"], ["routine_folders"], ["routine_folders", 0, "id"], ["routine_folders", 0, "index"], ["routine_folders", 0, "title"]],
    optional: [],
    extraKeyAt: ["routine_folders", 0],
  },
  { name: "create-workout reply", schema: HevyCreateWorkoutReplySchema, file: "post-workout-reply.json", required: [["workout"], ...workoutRequired(["workout", 0])], optional: [], extraKeyAt: [] },
  { name: "update-workout reply", schema: HevyUpdateWorkoutReplySchema, file: "put-workout-reply.json", required: workoutRequired([]), optional: [], extraKeyAt: [] },
];

describe("19.0 AC3 — Hevy reply schemas", () => {
  describe.each(CASES)("$name", ({ schema, file, required, optional, extraKeyAt }) => {
    const data = fixture(file);

    it("parses the documented example", () => {
      expect(schema.safeParse(data).success).toBe(true);
    });

    it("strips an extra key", () => {
      const extra = withValue(data, [...extraKeyAt, "unexpected_field"], "x");
      const parsed = schema.parse(extra);
      expect(at(parsed, [...extraKeyAt, "unexpected_field"])).not.toHaveProperty("unexpected_field");
    });

    it.each(optional.map((p) => [p.join(".")]))("tolerates %s as null or absent", (joined) => {
      const path = optional.find((p) => p.join(".") === joined)!;
      expect(schema.safeParse(withValue(data, path, null)).success).toBe(true);
      expect(schema.safeParse(without(data, path)).success).toBe(true);
    });

    it.each(required.map((p) => [p.join(".")]))("rejects a missing %s", (joined) => {
      const path = required.find((p) => p.join(".") === joined)!;
      expect(schema.safeParse(without(data, path)).success).toBe(false);
    });
  });

  it("a wrong type fails (page as a string)", () => {
    expect(HevyWorkoutPageSchema.safeParse(withValue(fixture("workouts-page.json"), ["page"], "1")).success).toBe(false);
  });

  it.each([
    ["bodyweight_weighted", "bodyweight_reps"],
    ["bodyweight_assisted", "bodyweight_assisted_reps"],
    ["weight_reps", "weight_reps"],
    ["bodyweight_reps", "bodyweight_reps"],
  ] as const)("D19: Hevy's real type %s reads as %s", (raw, type) => {
    expect(HevyTemplateSchema.parse(withValue(fixture("template.json"), ["type"], raw)).type).toBe(type);
    expect(readHevyType(raw)).toBe(type);
  });

  it.each(["floors_duration", "steps_duration", "cardio"])("D19: an unsupported type (%s) parses as null, so one template never fails a page", (raw) => {
    expect(HevyTemplateSchema.parse(withValue(fixture("template.json"), ["type"], raw)).type).toBe(null);
    const page = fixture("templates-page.json") as { exercise_templates: unknown[] };
    const mixed = { ...page, exercise_templates: [...page.exercise_templates, withValue(fixture("template.json"), ["type"], raw)] };
    expect(HevyTemplatePageSchema.safeParse(mixed).success).toBe(true);
  });

  it("a template type that is not a string still fails", () => {
    expect(HevyTemplateSchema.safeParse(withValue(fixture("template.json"), ["type"], 3)).success).toBe(false);
  });

  it("a set with an unknown type parses and keeps the string (Spec 20.1 D9)", () => {
    const parsed = HevySetSchema.parse({ type: "superset", reps: 5 });
    expect(parsed.type).toBe("superset");
  });

  it("a muscle or equipment value outside Hevy's list is kept as a string", () => {
    const t = HevyTemplateSchema.parse(withValue(fixture("template.json"), ["equipment"], "trap_bar"));
    expect(t.equipment).toBe("trap_bar");
  });

  it("the workout count is a non-negative integer", () => {
    expect(HevyWorkoutCountSchema.parse({ workout_count: 1043 }).workout_count).toBe(1043);
    expect(HevyWorkoutCountSchema.safeParse({ workout_count: -1 }).success).toBe(false);
    expect(HevyWorkoutCountSchema.safeParse({ workout_count: 1.5 }).success).toBe(false);
  });

  it("the create-template reply's id is a string, from a number or a string", () => {
    expect(HevyCreateTemplateReplySchema.parse({ id: 42 }).id).toBe("42");
    expect(HevyCreateTemplateReplySchema.parse({ id: "A1" }).id).toBe("A1");
    expect(HevyCreateTemplateReplySchema.safeParse({}).success).toBe(false);
  });

  it("the create-workout reply needs the one-element array", () => {
    const workout = fixture("workout.json");
    expect(HevyCreateWorkoutReplySchema.safeParse({ workout: [] }).success).toBe(false);
    expect(HevyCreateWorkoutReplySchema.safeParse({ workout: [workout, workout] }).success).toBe(false);
    expect(HevyCreateWorkoutReplySchema.safeParse({ workout }).success).toBe(false);
  });
});

describe("19.0 AC3 — the bodies we send", () => {
  const post = {
    workout: {
      title: "Push",
      description: null,
      start_time: "2026-10-01T10:00:00.000Z",
      end_time: "2026-10-01T11:00:00.000Z",
      is_private: true,
      exercises: [
        { exercise_template_id: "05293BCA", superset_id: null, notes: null, sets: [{ type: "normal", weight_kg: 100, reps: 5, rpe: 8 }] },
      ],
    },
  };

  it("a well-formed workout body parses", () => {
    expect(HevyPostWorkoutSchema.safeParse(post).success).toBe(true);
  });

  it.each([
    ["the body", ["extra"]],
    ["the workout", ["workout", "extra"]],
    ["an exercise", ["workout", "exercises", 0, "extra"]],
    ["a set", ["workout", "exercises", 0, "sets", 0, "extra"]],
  ] as const)("rejects an unknown key on %s", (_l, path) => {
    expect(HevyPostWorkoutSchema.safeParse(withValue(post, path, 1)).success).toBe(false);
  });

  it("rejects an RPE that is not a Hevy step", () => {
    expect(HevyPostWorkoutSchema.safeParse(withValue(post, ["workout", "exercises", 0, "sets", 0, "rpe"], 6.5)).success).toBe(false);
  });

  it("rejects a fractional distance", () => {
    expect(HevyPostWorkoutSchema.safeParse(withValue(post, ["workout", "exercises", 0, "sets", 0, "distance_meters"], 1.5)).success).toBe(false);
  });

  it("never carries custom_metric", () => {
    expect(HevyPostWorkoutSchema.safeParse(withValue(post, ["workout", "exercises", 0, "sets", 0, "custom_metric"], 3)).success).toBe(false);
  });

  it("the create-template body uses Hevy's enums and is strict", () => {
    const body = { exercise: { title: "Echo Bike", exercise_type: "reps_only", equipment_category: "machine", muscle_group: "cardio", other_muscles: [] } };
    expect(HevyCreateTemplateBodySchema.safeParse(body).success).toBe(true);
    expect(HevyCreateTemplateBodySchema.safeParse(withValue(body, ["exercise", "muscle_group"], "quads")).success).toBe(false);
    expect(HevyCreateTemplateBodySchema.safeParse(withValue(body, ["exercise", "equipment_category"], "cable")).success).toBe(false);
    expect(HevyCreateTemplateBodySchema.safeParse(withValue(body, ["exercise", "extra"], 1)).success).toBe(false);
  });
});

describe("20.0 AC5 — user info keeps what the key check reads", () => {
  it("keeps username and is_pro from Hevy's reply", () => {
    const parsed = HevyUserInfoSchema.parse(fixture("user-info.json"));
    expect(parsed.data).toMatchObject({ id: "9c465af3-de7d-42bc-9c7c-f0170396358b", username: "jhon", is_pro: true });
  });

  it("is_pro is required, username is optional", () => {
    const reply = fixture("user-info.json") as { data: Record<string, unknown> };
    const without = (key: string) => ({ data: Object.fromEntries(Object.entries(reply.data).filter(([k]) => k !== key)) });
    expect(HevyUserInfoSchema.safeParse(without("is_pro")).success).toBe(false);
    expect(HevyUserInfoSchema.safeParse(without("username")).success).toBe(true);
    expect(HevyUserInfoSchema.safeParse({ data: { ...reply.data, is_pro: "yes" } }).success).toBe(false);
  });
});
