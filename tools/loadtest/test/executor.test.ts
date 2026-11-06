import { describe, expect, it } from "vitest";
import { newLifterState, runActions, type ExecutorIo } from "../src/plan/executor.ts";
import { buildSession, type Action } from "../src/plan/session.ts";
import { routeName } from "../src/plan/tags.ts";
import { SET_WORK_S } from "../src/plan/constants.ts";

const ROUTINE = "0190f6c2-1111-7000-8000-000000000001";
const WORKOUT = "0190f6c2-4444-7000-8000-000000000001";
const we = (i: number) => `0190f6c2-5555-7000-8000-${String(i).padStart(12, "0")}`;
const ex = (i: number) => `0190f6c2-6666-7000-8000-${String(i).padStart(12, "0")}`;

/** A fake k6: records (method, path, body) and tags, sleeps instantly, answers like the API. */
function fakeIo(opts: { startStatus?: number; setStatus?: number } = {}) {
  const log: { method: string; path: string; body?: unknown }[] = [];
  const tags: string[] = [];
  const slept: number[] = [];
  const detail = {
    id: WORKOUT,
    exercises: [2, 0, 1, 3, 4, 5].map((pos) => ({ id: we(pos), exerciseId: ex(pos), position: pos })),
  };
  const io: ExecutorIo = {
    tag: (t) => void tags.push(t.name!),
    sleep: (s) => void slept.push(s),
    request: (method, path, body) => {
      log.push({ method, path, body });
      const status =
        method === "POST" && path === "/v1/workouts"
          ? (opts.startStatus ?? 201)
          : method === "POST"
            ? (opts.setStatus ?? 201)
            : method === "GET" && path === "/v1/workouts/active"
              ? 200
              : 200;
      const json = () => (path === "/v1/workouts/active" ? detail : path === "/v1/workouts" ? { id: WORKOUT } : {});
      return { status, json };
    },
  };
  return { io, log, tags, slept };
}

const state = () => newLifterState({ seed: 1, routineId: ROUTINE, plannedWeights: [100, 70, 60, 40, 120, null] });

describe("AC2 — the executor follows the plan", () => {
  it("one full session sends the planned requests in order", () => {
    const { actions } = buildSession({ seed: 1, sets: [2, 1], pushFactor: 1 });
    const { io, log } = fakeIo();
    runActions(actions, io, state());
    expect(log.map((r) => `${r.method} ${routeName(r.method, r.path)}`)).toEqual([
      "GET me",
      "GET exercises",
      "GET muscle_groups",
      "GET equipment",
      "GET routines",
      "GET workout_active",
      "GET personal_records",
      "POST workout_start",
      "GET workout_active",
      "POST set_save",
      "POST set_save",
      "POST set_save",
      "PATCH workout_finish",
      "GET history",
      "GET progress",
    ]);
  });

  it("each set goes to the workout exercise at that item's position, with the item's planned weight", () => {
    const actions: Action[] = [{ kind: "start" }, { kind: "set", itemIndex: 0, setIndex: 0 }, { kind: "set", itemIndex: 5, setIndex: 0 }];
    const { io, log } = fakeIo();
    runActions(actions, io, state());
    const sets = log.filter((r) => r.method === "POST" && r.path !== "/v1/workouts");
    expect(sets.map((r) => r.path)).toEqual([`/v1/workout-exercises/${we(0)}/sets`, `/v1/workout-exercises/${we(5)}/sets`]);
    expect(sets[0]!.body).toHaveProperty("weight");
    expect(sets[1]!.body).not.toHaveProperty("weight");
  });

  it("time under the bar before each set, and the planned rest after", () => {
    const actions: Action[] = [{ kind: "start" }, { kind: "set", itemIndex: 0, setIndex: 0 }, { kind: "rest", seconds: 123 }];
    const { io, slept } = fakeIo();
    runActions(actions, io, state());
    expect(slept).toEqual([SET_WORK_S, 123]);
  });

  it("progress reads the exercise (not the workout exercise) of the chosen item", () => {
    const actions: Action[] = [{ kind: "start" }, { kind: "progress", itemIndex: 3 }];
    const { io, log } = fakeIo();
    runActions(actions, io, state());
    expect(log.at(-1)!.path).toBe(`/v1/progress/exercises/${ex(3)}`);
  });
});

describe("Review Focus 1 — a 409 on start adopts the live workout", () => {
  it("reads the active workout and logs its sets into it", () => {
    const actions: Action[] = [{ kind: "start" }, { kind: "set", itemIndex: 1, setIndex: 0 }, { kind: "finish" }];
    const { io, log } = fakeIo({ startStatus: 409 });
    runActions(actions, io, state());
    expect(log.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /v1/workouts",
      "GET /v1/workouts/active",
      `POST /v1/workout-exercises/${we(1)}/sets`,
      `PATCH /v1/workouts/${WORKOUT}`,
    ]);
  });

  it("any other start failure leaves no workout: sets and finish are skipped", () => {
    const actions: Action[] = [{ kind: "start" }, { kind: "set", itemIndex: 0, setIndex: 0 }, { kind: "finish" }, { kind: "history" }];
    const { io, log } = fakeIo({ startStatus: 500 });
    runActions(actions, io, state());
    expect(log.map((r) => r.method)).toEqual(["POST", "GET"]);
  });
});

describe("Spec 16 §6.2 — never retry to hide a failure", () => {
  it("a 500 on a set is sent once", () => {
    const actions: Action[] = [{ kind: "start" }, { kind: "set", itemIndex: 0, setIndex: 0 }];
    const { io, log } = fakeIo({ setStatus: 500 });
    runActions(actions, io, state());
    expect(log.filter((r) => r.path.endsWith("/sets"))).toHaveLength(1);
  });
});

describe("AC11 — every request is tagged with its template first", () => {
  it("a tag call precedes each request, and its name is routeName(method, path)", () => {
    const { actions } = buildSession({ seed: 2, sets: [3, 3, 2], pushFactor: 1 });
    const { io, log, tags } = fakeIo();
    runActions(actions, io, state());
    expect(tags).toEqual(log.map((r) => routeName(r.method, r.path)));
  });
});
