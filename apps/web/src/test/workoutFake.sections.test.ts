import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkoutDetail } from "@sin/core";
import { resetConfigCache } from "../config";
import { API_BASE_URL, stubWebEnv } from "./catalogHarness";
import { exerciseId, makeExercise } from "./catalogFixtures";
import { server } from "./msw/server";
import { makeWorkoutDetail, type ExerciseSpec } from "./workoutFixtures";
import { createWorkoutFake } from "./workoutFake";

/** Fake fidelity (untagged): the fake's section routes follow Spec 09.4 §6.2–§6.5, as the server does. */

const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });

beforeEach(() => stubWebEnv());
afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_BASE_URL}/v1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : undefined };
}
const slugOf = (json: Record<string, unknown> | undefined) => new URL(String(json!["type"])).pathname.split("/").pop();

const ex = (name: string, sectionIndex: number | null = null, extra: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, sectionIndex, ...extra });

function boot(active: WorkoutDetail) {
  const fake = createWorkoutFake({ active, catalog: [bench] });
  server.use(...fake.handlers);
  return fake;
}
const order = (fake: ReturnType<typeof boot>) => {
  const w = fake.state.active!;
  const names = new Map(w.sections.map((s) => [s.id as string, s.name]));
  return [...w.exercises]
    .sort((a, b) => a.position - b.position)
    .map((e) => `${e.exerciseNameSnapshot}${e.sectionId ? `(${names.get(e.sectionId)})` : ""}`);
};
const idOf = (w: WorkoutDetail, name: string) => w.exercises.find((e) => e.exerciseNameSnapshot === name)!.id;
const sectionId = (w: WorkoutDetail, name: string) => w.sections.find((s) => s.name === name)!.id;

describe("fake: §6.2 placement of a section move", () => {
  it("[·A] + empty W: move A into W → [A(W)]", async () => {
    const fake = boot(makeWorkoutDetail({ sections: [{ name: "W" }], exercises: [ex("A")] }));
    const w = fake.state.active!;
    const res = await call("PATCH", `/workout-exercises/${idOf(w, "A")}`, { sectionId: sectionId(w, "W") });
    expect(res.status).toBe(200);
    expect(res.json!["sectionId"]).toBe(sectionId(w, "W"));
    expect(order(fake)).toEqual(["A(W)"]);
  });

  it("[a1(W), a2(W), b1(S), ·X]: move X into W → after a2", async () => {
    const fake = boot(makeWorkoutDetail({ sections: [{ name: "W" }, { name: "S" }], exercises: [ex("a1", 0), ex("a2", 0), ex("b1", 1), ex("X")] }));
    const w = fake.state.active!;
    await call("PATCH", `/workout-exercises/${idOf(w, "X")}`, { sectionId: sectionId(w, "W") });
    expect(order(fake)).toEqual(["a1(W)", "a2(W)", "X(W)", "b1(S)"]);
  });

  it("[a1(W), b1(S)]: move a1 to No section → stays first", async () => {
    const fake = boot(makeWorkoutDetail({ sections: [{ name: "W" }, { name: "S" }], exercises: [ex("a1", 0), ex("b1", 1)] }));
    await call("PATCH", `/workout-exercises/${idOf(fake.state.active!, "a1")}`, { sectionId: null });
    expect(order(fake)).toEqual(["a1", "b1(S)"]);
  });

  it("[·L, a1(W), b1(S), ·Y]: move b1 to No section → [·L, b1, a1, ·Y]", async () => {
    const fake = boot(makeWorkoutDetail({ sections: [{ name: "W" }, { name: "S" }], exercises: [ex("L"), ex("a1", 0), ex("b1", 1), ex("Y")] }));
    await call("PATCH", `/workout-exercises/${idOf(fake.state.active!, "b1")}`, { sectionId: null });
    expect(order(fake)).toEqual(["L", "b1", "a1(W)", "Y"]);
  });

  it("[a1(S), ·M, b2(S), ·X]: move X into S → after b2", async () => {
    const fake = boot(makeWorkoutDetail({ sections: [{ name: "S" }], exercises: [ex("a1", 0), ex("M"), ex("b2", 0), ex("X")] }));
    const w = fake.state.active!;
    await call("PATCH", `/workout-exercises/${idOf(w, "X")}`, { sectionId: sectionId(w, "S") });
    expect(order(fake)).toEqual(["a1(S)", "M", "b2(S)", "X(S)"]);
  });

  it("the same section is a no-op; an unknown section is 404; sectionId with position is 422", async () => {
    const fake = boot(makeWorkoutDetail({ sections: [{ name: "S" }], exercises: [ex("a1", 0, { supersetGroup: 1 }), ex("b", 0, { supersetGroup: 1 })] }));
    const w = fake.state.active!;
    await call("PATCH", `/workout-exercises/${idOf(w, "a1")}`, { sectionId: sectionId(w, "S") });
    expect(fake.state.active!.exercises.find((e) => e.exerciseNameSnapshot === "a1")!.supersetGroup).toBe(1);
    const missing = await call("PATCH", `/workout-exercises/${idOf(w, "a1")}`, { sectionId: "01900000-0000-7000-8000-000000000000" });
    expect(missing.status).toBe(404);
    const both = await call("PATCH", `/workout-exercises/${idOf(w, "a1")}`, { sectionId: null, position: 0 });
    expect(both.status).toBe(422);
  });

  it("a section change clears the superset label", async () => {
    const fake = boot(makeWorkoutDetail({ sections: [{ name: "S" }], exercises: [ex("a", null, { supersetGroup: 2 }), ex("b", null, { supersetGroup: 2 })] }));
    const w = fake.state.active!;
    await call("PATCH", `/workout-exercises/${idOf(w, "a")}`, { sectionId: sectionId(w, "S") });
    expect(fake.state.active!.exercises.find((e) => e.exerciseNameSnapshot === "a")!.supersetGroup).toBeNull();
    expect(fake.state.active!.exercises.find((e) => e.exerciseNameSnapshot === "b")!.supersetGroup).toBe(2);
  });
});

describe("fake: §6.4 section writes", () => {
  it("create appends with addedInWorkout: true; the ninth is 409 workout-section-limit", async () => {
    const fake = boot(makeWorkoutDetail({ sections: [{ name: "W" }] }));
    const res = await call("POST", `/workouts/${fake.state.active!.id}/sections`, { name: " Cooldown ", notes: "Stretch" });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ position: 1, name: "Cooldown", notes: "Stretch", addedInWorkout: true });
    for (let i = 2; i < 8; i += 1) expect((await call("POST", `/workouts/${fake.state.active!.id}/sections`, { name: `S${i}` })).status).toBe(201);
    const ninth = await call("POST", `/workouts/${fake.state.active!.id}/sections`, { name: "Nine" });
    expect(ninth.status).toBe(409);
    expect(slugOf(ninth.json)).toBe("workout-section-limit");
    expect((await call("POST", `/workouts/00000000-0000-4000-8000-00000000dead/sections`, { name: "X" })).status).toBe(404);
    expect((await call("POST", `/workouts/${fake.state.active!.id}/sections`, { name: "  " })).status).toBe(422);
  });

  it("update applies the keys given; an unknown id is 404", async () => {
    const fake = boot(makeWorkoutDetail({ sections: [{ name: "W", notes: "n" }] }));
    const id = fake.state.active!.sections[0]!.id;
    const res = await call("PATCH", `/workout-sections/${id}`, { notes: null });
    expect(res.json).toMatchObject({ name: "W", notes: null, addedInWorkout: false });
    expect(fake.state.active!.sections[0]!.notes).toBeNull();
    expect((await call("PATCH", `/workout-sections/01900000-0000-7000-8000-000000000000`, { name: "X" })).status).toBe(404);
  });

  it("remove loosens its exercises in place and renumbers the later sections; a second remove is 404", async () => {
    const fake = boot(makeWorkoutDetail({ sections: [{ name: "W" }, { name: "S" }, { name: "C" }], exercises: [ex("a", 0), ex("b", 1), ex("c", 2)] }));
    const s = sectionId(fake.state.active!, "S");
    expect((await call("DELETE", `/workout-sections/${s}`)).status).toBe(204);
    expect(order(fake)).toEqual(["a(W)", "b", "c(C)"]);
    expect(fake.state.active!.sections.map((x) => [x.name, x.position])).toEqual([
      ["W", 0],
      ["C", 1],
    ]);
    expect((await call("DELETE", `/workout-sections/${s}`)).status).toBe(404);
  });
});

describe("fake: §6.5 C4 on a plain add", () => {
  it("joins the last section iff it was added in the workout, before a loose tail", async () => {
    const fake = boot(makeWorkoutDetail({ sections: [{ name: "W" }, { name: "S" }], exercises: [ex("a1", 0), ex("b1", 1), ex("Y")] }));
    const id = fake.state.active!.id;
    await call("POST", `/workouts/${id}/exercises`, { exerciseId: bench.id });
    expect(order(fake)).toEqual(["a1(W)", "b1(S)", "Y", "Bench Press"]); // last section copied: loose at the end
    await call("POST", `/workouts/${id}/sections`, { name: "C" });
    await call("POST", `/workouts/${id}/exercises`, { exerciseId: bench.id });
    expect(order(fake)).toEqual(["a1(W)", "b1(S)", "Bench Press(C)", "Y", "Bench Press"]);
    expect(fake.state.active!.exercises.map((e) => e.position).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
});
