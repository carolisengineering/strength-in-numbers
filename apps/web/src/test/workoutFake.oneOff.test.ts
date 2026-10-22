import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../config";
import { API_BASE_URL, stubWebEnv } from "./catalogHarness";
import { exerciseId, makeExercise } from "./catalogFixtures";
import { server } from "./msw/server";
import { makeRoutine, makeRoutineItem, makeSet, makeWorkoutDetail, routineId } from "./workoutFixtures";
import { createWorkoutFake, type WorkoutFakeOptions } from "./workoutFake";

const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });
const T = Date.parse("2026-10-16T09:00:00.000Z");

beforeEach(() => stubWebEnv());
afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_BASE_URL}/v1${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, contentType: res.headers.get("content-type"), json: text ? (JSON.parse(text) as Record<string, unknown>) : undefined };
}

function boot(options: WorkoutFakeOptions = {}) {
  const fake = createWorkoutFake({ catalog: [bench], ...options });
  server.use(...fake.handlers);
  return fake;
}

const write = (name: string) => ({ name, items: [{ exerciseId: bench.id }] });

describe("10.5 fake — one-off semantics", () => {
  it("create with oneOff: true stores now + 14 days; without it, null; PUT with oneOff is a 422", async () => {
    boot({ now: () => T });
    const one = await call("POST", "/routines", { ...write("Class"), oneOff: true });
    expect(one.status).toBe(201);
    expect(one.json!["oneOffUntil"]).toBe(new Date(T + 14 * 86_400_000).toISOString());
    const plain = await call("POST", "/routines", write("Push"));
    expect(plain.json!["oneOffUntil"]).toBeNull();
    const put = await call("PUT", `/routines/${String(one.json!["id"])}`, { ...write("Class"), oneOff: true });
    expect(put.status).toBe(422);
    const edit = await call("PUT", `/routines/${String(one.json!["id"])}`, write("Class renamed"));
    expect(edit.json!["oneOffUntil"]).toBe(one.json!["oneOffUntil"]);
  });

  it("lists one-offs first, newest created first, then ordinary by lowercase name", async () => {
    const U = "2026-10-30T09:00:00.000Z";
    boot({
      routines: [
        makeRoutine({ id: routineId(1), name: "b" }),
        makeRoutine({ id: routineId(2), name: "Old class", oneOffUntil: U, createdAt: "2026-10-15T09:00:00.000Z" }),
        makeRoutine({ id: routineId(3), name: "A" }),
        makeRoutine({ id: routineId(4), name: "New class", oneOffUntil: U, createdAt: "2026-10-15T09:00:00.001Z" }),
      ],
    });
    const list = await call("GET", "/routines");
    expect((list.json!["routines"] as { id: string }[]).map((r) => r.id)).toEqual([routineId(4), routineId(2), routineId(3), routineId(1)]);
  });

  it("keep → 204 with no body; the mark is gone; a missing id → 404", async () => {
    const fake = boot({ routines: [makeRoutine({ id: routineId(1), oneOffUntil: "2026-10-30T09:00:00.000Z" })] });
    const kept = await call("POST", `/routines/${routineId(1)}/keep`);
    expect(kept.status).toBe(204);
    expect(kept.contentType).toBeNull();
    expect(kept.json).toBeUndefined();
    expect((await call("GET", `/routines/${routineId(1)}`)).json!["oneOffUntil"]).toBeNull();
    expect(fake.requests.at(-2)).toMatchObject({ method: "POST", path: `/v1/routines/${routineId(1)}/keep`, body: undefined });
    expect((await call("POST", `/routines/${routineId(9)}/keep`)).status).toBe(404);
  });

  describe("a workout started from a one-off", () => {
    const cls = () => makeRoutine({ id: routineId(1), name: "Class", oneOffUntil: "2026-10-30T09:00:00.000Z", items: [makeRoutineItem({ exerciseId: bench.id })] });

    async function startFromOneOff() {
      const fake = boot({ routines: [cls()] });
      const started = await call("POST", "/workouts", { clientGeneratedId: crypto.randomUUID(), startedAt: new Date().toISOString(), routineId: routineId(1) });
      expect(started.status).toBe(201);
      const id = String(started.json!["id"]);
      const active = await call("GET", "/workouts/active");
      expect(active.json!["routineIsOneOff"]).toBe(true);
      return { fake, id };
    }

    it("finish without keepRoutine removes the routine; the finished detail reads false", async () => {
      const { fake, id } = await startFromOneOff();
      expect((await call("PATCH", `/workouts/${id}`, { endedAt: new Date().toISOString() })).status).toBe(200);
      expect(fake.state.routines.has(routineId(1))).toBe(false);
      expect((await call("GET", `/workouts/${id}`)).json!["routineIsOneOff"]).toBe(false);
    });

    it("finish with keepRoutine: true keeps it as an ordinary routine", async () => {
      const { fake, id } = await startFromOneOff();
      await call("PATCH", `/workouts/${id}`, { endedAt: new Date().toISOString(), keepRoutine: true });
      expect(fake.state.routines.get(routineId(1))?.oneOffUntil).toBeNull();
    });

    it("discarding the live workout leaves the routine alone", async () => {
      const { fake, id } = await startFromOneOff();
      expect((await call("DELETE", `/workouts/${id}`)).status).toBe(204);
      expect(fake.state.routines.get(routineId(1))?.oneOffUntil).toBe("2026-10-30T09:00:00.000Z");
    });

    it("a seeded active workout links through activeRoutineId; Keep elsewhere turns the flag off", async () => {
      const active = makeWorkoutDetail({ routineName: "Class", exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet()] }] });
      boot({ routines: [cls()], active, activeRoutineId: routineId(1) });
      expect((await call("GET", "/workouts/active")).json!["routineIsOneOff"]).toBe(true);
      await call("POST", `/routines/${routineId(1)}/keep`);
      expect((await call("GET", "/workouts/active")).json!["routineIsOneOff"]).toBe(false);
    });
  });
});
